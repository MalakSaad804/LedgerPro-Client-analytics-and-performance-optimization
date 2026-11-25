const Redis = require('ioredis');

// Cache with two modes:
//   - Redis (when REDIS_URL is set and reachable)
//   - in-memory fallback (so the API still works without Redis)
//
// Invalidation uses a version number per namespace: keys look like  analytics:<version>:<key>.
// Bumping the version makes every old key unreachable in one cheap step (no key scanning).

let redis = null;
const mem = new Map(); // key -> { value, exp }
const memVersions = new Map(); // namespace -> number
const stats = { hits: 0, misses: 0 };
const MEM_MAX = 500;

function init(url = process.env.REDIS_URL) {
  if (redis) { redis.disconnect(); redis = null; }
  mem.clear();
  memVersions.clear();
  stats.hits = 0;
  stats.misses = 0;
  if (!url) return;

  let warned = false;
  redis = new Redis(url, {
    enableOfflineQueue: false, // fail fast instead of waiting while Redis is down
    maxRetriesPerRequest: 1,
    retryStrategy: (n) => Math.min(n * 500, 5000),
  });
  redis.on('error', (e) => {
    if (!warned) { warned = true; console.warn('Redis unavailable, using in-memory cache:', e.message); }
  });
  redis.on('ready', () => { warned = false; console.log('Redis cache connected'); });
}

const ready = () => Boolean(redis) && redis.status === 'ready';
const mode = () => (ready() ? 'redis' : 'memory');

async function getVersion(ns) {
  if (ready()) {
    try { return (await redis.get(`ver:${ns}`)) || '0'; } catch { /* fall through */ }
  }
  return String(memVersions.get(ns) || 0);
}

// Call this whenever the underlying data changes.
async function bump(ns) {
  memVersions.set(ns, (memVersions.get(ns) || 0) + 1);
  if (ready()) {
    try { await redis.incr(`ver:${ns}`); } catch { /* ignore */ }
  }
}

// cached('analytics', 'all:trends:...', 300, () => expensiveQuery())
// returns { value, status } where status is HIT, MISS or BYPASS
async function cached(ns, key, ttlSec, compute, { bypass = false } = {}) {
  if (bypass) return { value: await compute(), status: 'BYPASS' };

  const k = `${ns}:${await getVersion(ns)}:${key}`;

  if (ready()) {
    try {
      const raw = await redis.get(k);
      if (raw !== null) { stats.hits += 1; return { value: JSON.parse(raw), status: 'HIT' }; }
    } catch { /* treat as a miss */ }
  } else {
    const e = mem.get(k);
    if (e && e.exp > Date.now()) { stats.hits += 1; return { value: e.value, status: 'HIT' }; }
  }

  stats.misses += 1;
  const value = await compute();

  if (ready()) {
    try { await redis.set(k, JSON.stringify(value), 'EX', ttlSec); } catch { /* ignore */ }
  } else {
    if (mem.size >= MEM_MAX) mem.delete(mem.keys().next().value); // drop the oldest entry
    mem.set(k, { value, exp: Date.now() + ttlSec * 1000 });
  }
  return { value, status: 'MISS' };
}

async function close() {
  if (redis) { await redis.quit().catch(() => {}); redis = null; }
}

module.exports = { init, cached, bump, mode, stats, close };
