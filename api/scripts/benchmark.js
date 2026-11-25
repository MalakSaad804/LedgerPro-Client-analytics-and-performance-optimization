/* Performance benchmark for LedgerPro analytics.
 *
 *   npm run benchmark                  (200,000 bookings, local MongoDB)
 *   BENCH_BOOKINGS=50000 npm run benchmark
 *
 * What it does
 *   1. Builds a separate database (ledgerpro_bench) full of realistic bookings. Your real data is never touched.
 *   2. Runs the app's real queries under three index setups:
 *        A = no indexes     B = indexes from Tasks 1-3     C = final indexes (Task 4)
 *      and records time, documents examined and the query plan (explain).
 *   3. Turns on the MongoDB profiler and lists the operations slower than BENCH_SLOWMS.
 *   4. Measures what the indexes cost on writes.
 *   5. Measures the cache (Redis or in-memory): miss vs hit, directly and over HTTP.
 *   6. Writes docs/benchmark-results.md and docs/benchmark-results.json
 */
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const Booking = require('../src/models/Booking');
const Availability = require('../src/models/Availability');
const analytics = require('../src/services/analytics.service');
const cache = require('../src/utils/cache');
const { dateStrOf, DAY_MS } = require('../src/utils/slots');

const N = Number(process.env.BENCH_BOOKINGS || 200000);
const URI = process.env.BENCH_MONGO_URI || 'mongodb://127.0.0.1:27017/ledgerpro_bench';
const SLOWMS = Number(process.env.BENCH_SLOWMS || 50);
const RUNS = 7;
const OUT = path.join(__dirname, '..', 'docs');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'benchmark-secret';
process.env.BUSINESS_TZ_OFFSET_MIN = process.env.BUSINESS_TZ_OFFSET_MIN || '300';

if (!/bench/i.test(new URL(URI).pathname)) {
  console.error('Refusing to run: the benchmark database name must contain "bench" so real data is never dropped.');
  process.exit(1);
}

// ---------- helpers ----------
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const fmt = (n) => (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2));
const oid = () => new mongoose.Types.ObjectId();

function rng(seed) { // small deterministic random generator: same data every run
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// walk an explain() document and summarise the plan
function describePlan(explain) {
  const stages = new Set();
  const indexes = new Set();
  let docs = null; let keys = null; let millis = null;
  (function walk(o) {
    if (!o || typeof o !== 'object') return;
    if (typeof o.stage === 'string') stages.add(o.stage);
    if (typeof o.indexName === 'string') indexes.add(o.indexName);
    if (docs === null && typeof o.totalDocsExamined === 'number') {
      docs = o.totalDocsExamined; keys = o.totalKeysExamined; millis = o.executionTimeMillis;
    }
    Object.values(o).forEach(walk);
  })(explain);
  const scan = stages.has('COLLSCAN') ? 'COLLSCAN' : stages.has('IXSCAN') || indexes.size ? 'IXSCAN' : '?';
  const covered = scan === 'IXSCAN' && docs === 0;
  return { scan, covered, docs, keys, serverMs: millis, indexes: [...indexes] };
}

// ---------- seed ----------
async function seed() {
  console.log(`Seeding ${N.toLocaleString()} bookings into ${URI} ...`);
  const db = mongoose.connection.db;
  await db.dropDatabase();
  const rand = rng(42);
  const staff = [oid(), oid(), oid()];
  const services = [{ id: oid(), mins: 60 }, { id: oid(), mins: 90 }, { id: oid(), mins: 30 }];
  const customers = Array.from({ length: 800 }, oid);
  await Availability.insertMany(staff.flatMap((s) => [1, 2, 3, 4, 5].map((d) => ({ staff: s, dayOfWeek: d, startTime: '09:00', endTime: '17:00' }))));

  const hourWeights = [0, 0, 0, 0, 0, 0, 0, 0, 0, 6, 10, 9, 5, 4, 8, 9, 5, 0]; // busiest around 10-11 and 14-15
  const totalW = hourWeights.reduce((a, b) => a + b, 0);
  const pickHour = () => { let r = rand() * totalW; for (let h = 0; h < 18; h += 1) { r -= hourWeights[h]; if (r <= 0) return h; } return 10; };

  const now = Date.now();
  const DAY = DAY_MS;
  const batch = [];
  let inserted = 0;
  const col = Booking.collection;
  while (inserted + batch.length < N) {
    const dayOffset = Math.floor(rand() * 395) - 365; // last 365 days up to 30 days ahead
    const day = new Date(now + dayOffset * DAY);
    const dow = day.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const svc = services[Math.floor(rand() * 3)];
    const hour = pickHour();
    const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour - 5, rand() < 0.5 ? 0 : 30));
    const past = start.getTime() < now;
    const r = rand();
    const status = past ? (r < 0.7 ? 'completed' : r < 0.82 ? 'cancelled' : 'confirmed') : (r < 0.9 ? 'confirmed' : r < 0.95 ? 'pending' : 'cancelled');
    batch.push({
      _id: oid(), customer: customers[Math.floor(rand() * customers.length)], service: svc.id,
      staff: staff[Math.floor(rand() * 3)], slotStart: start, slotEnd: new Date(start.getTime() + svc.mins * 60000),
      status, createdAt: start, updatedAt: start,
    });
    if (batch.length === 20000) { await col.insertMany(batch.splice(0), { ordered: false }); inserted += 20000; process.stdout.write('.'); }
  }
  if (batch.length) { inserted += batch.length; await col.insertMany(batch, { ordered: false }); }
  console.log(`\nInserted ${inserted.toLocaleString()} bookings.`);
  return { staff, customers };
}

// ---------- index setups ----------
const CONFIGS = [
  { key: 'A', label: 'A: no indexes (only _id)', specs: [] },
  {
    key: 'B', label: 'B: indexes from Tasks 1-3',
    specs: [[{ customer: 1, slotStart: -1 }, {}], [{ service: 1, slotStart: 1, status: 1 }, {}], [{ staff: 1, slotStart: 1 }, {}]],
  },
  { key: 'C', label: 'C: final indexes (Task 4)', specs: Booking.schema.indexes() },
];

async function applyIndexes(cfg) {
  await Booking.collection.dropIndexes().catch(() => {});
  for (const [spec, opts] of cfg.specs) await Booking.collection.createIndex(spec, opts);
}

// ---------- the queries (same code the API runs) ----------
function buildQueries({ staff, customers }) {
  const to = dateStrOf(Date.now());
  const from = dateStrOf(Date.now() - 90 * DAY_MS);
  const staffId = String(staff[0]);
  const dayStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() - 3, 0));
  const dayFilter = { status: { $ne: 'cancelled' }, slotStart: { $gte: dayStart, $lt: new Date(dayStart.getTime() + DAY_MS) } };
  const agg = (pipeline) => ({
    run: () => Booking.aggregate(pipeline),
    explain: () => Booking.aggregate(pipeline).explain('executionStats'),
  });
  const find = (build) => ({ run: () => build(), explain: () => build().explain('executionStats') });
  const windowStart = new Date(Date.now() - 60 * DAY_MS);

  return [
    { id: 'staff_list', name: 'Staff dashboard list (1 staff, last 60 days, limit 1000)', ...find(() => Booking.find({ staff: staff[0], slotStart: { $gte: windowStart } }).sort({ slotStart: 1 }).limit(1000).lean()) },
    { id: 'my_bookings', name: 'Customer "my bookings" (1 customer)', ...find(() => Booking.find({ customer: customers[0] }).sort({ slotStart: -1 }).lean()) },
    { id: 'slot_lookup', name: 'Slot check: bookings of one day (booking page)', ...find(() => Booking.find({ ...dayFilter, staff: { $in: staff } }).select('staff slotStart slotEnd').lean()) },
    { id: 'trends_all_7d', name: 'Analytics trends, 7 days, all staff (admin)', ...agg(analytics.trendsPipeline({ scope: { staffId: null }, from: dateStrOf(Date.now() - 7 * DAY_MS), to, interval: 'day' })) },
    { id: 'trends_staff_7d', name: 'Analytics trends, 7 days, one staff member', ...agg(analytics.trendsPipeline({ scope: { staffId }, from: dateStrOf(Date.now() - 7 * DAY_MS), to, interval: 'day' })) },
    { id: 'trends_staff', name: 'Analytics trends, 90 days, one staff member', ...agg(analytics.trendsPipeline({ scope: { staffId }, from, to, interval: 'day' })) },
    { id: 'trends_all', name: 'Analytics trends, 90 days, all staff (admin)', ...agg(analytics.trendsPipeline({ scope: { staffId: null }, from, to, interval: 'day' })) },
    { id: 'peak_all', name: 'Analytics peak times, 90 days, all staff', ...agg(analytics.peakPipeline({ scope: { staffId: null }, from, to })) },
    { id: 'util_all', name: 'Analytics staff utilization, 90 days', ...agg(analytics.utilizationPipeline({ scope: { staffId: null }, from, to })) },
    { id: 'summary_all', name: 'Analytics summary (KPIs), 90 days', ...agg(analytics.summaryPipeline({ scope: { staffId: null }, from, to })) },
  ];
}

async function measure(queries) {
  const out = {};
  for (const q of queries) {
    await q.run(); await q.run(); // warm-up
    const times = [];
    let rows = 0;
    for (let i = 0; i < RUNS; i += 1) {
      const t = process.hrtime.bigint();
      const res = await q.run();
      times.push(Number(process.hrtime.bigint() - t) / 1e6);
      rows = res.length;
    }
    out[q.id] = { name: q.name, medianMs: median(times), maxMs: Math.max(...times), rows, plan: describePlan(await q.explain()) };
  }
  return out;
}

// ---------- profiler ----------
async function profile(queries) {
  const db = mongoose.connection.db;
  try {
    await db.command({ profile: 0 });
    await db.collection('system.profile').drop().catch(() => {});
    await db.command({ profile: 1, slowms: SLOWMS });
  } catch (e) {
    return { supported: false, reason: e.message, slow: [] };
  }
  for (const q of queries) await q.run();
  await db.command({ profile: 0 });
  const rows = await db.collection('system.profile')
    .find({ ns: `${db.databaseName}.bookings`, millis: { $gte: SLOWMS } }).sort({ millis: -1 }).toArray();
  const slow = rows.map((r) => ({
    op: r.op, millis: r.millis, plan: r.planSummary || (r.command?.aggregate ? 'aggregate' : ''),
    docsExamined: r.docsExamined ?? 0, keysExamined: r.keysExamined ?? 0, returned: r.nreturned ?? 0,
    what: r.command?.pipeline ? `aggregate (${r.command.pipeline.map((s) => Object.keys(s)[0]).join(' > ')})`
      : r.command?.find ? `find ${JSON.stringify(r.command.filter).slice(0, 90)}` : r.op,
  }));
  return { supported: true, slow };
}

// ---------- write cost ----------
async function writeCost() {
  const db = mongoose.connection.db;
  const res = {};
  for (const cfg of CONFIGS) {
    const col = db.collection(`write_test_${cfg.key}`);
    await col.drop().catch(() => {});
    for (const [spec, opts] of cfg.specs) await col.createIndex(spec, opts);
    const docs = Array.from({ length: 30000 }, (_, i) => ({
      customer: oid(), service: oid(), staff: oid(), status: 'confirmed',
      slotStart: new Date(Date.now() + i * 60000), slotEnd: new Date(Date.now() + i * 60000 + 3600000),
    }));
    const t = process.hrtime.bigint();
    for (let i = 0; i < docs.length; i += 5000) await col.insertMany(docs.slice(i, i + 5000));
    res[cfg.key] = Number(process.hrtime.bigint() - t) / 1e6 / docs.length * 1000; // microseconds per insert
    await col.drop();
  }
  return res;
}

// ---------- cache ----------
async function cacheBench() {
  const to = dateStrOf(Date.now());
  const from = dateStrOf(Date.now() - 90 * DAY_MS);
  const opts = { scope: { staffId: null }, from, to, interval: 'day' };
  const results = {};

  for (const mode of [process.env.REDIS_URL ? 'redis' : null, 'memory'].filter(Boolean)) {
    cache.init(mode === 'redis' ? process.env.REDIS_URL : undefined);
    if (mode === 'redis') await new Promise((r) => setTimeout(r, 800)); // wait for the connection
    const real = cache.mode();
    if (real !== mode) { results[mode] = { skipped: `Redis not reachable (using ${real})` }; continue; }

    // direct: the same aggregation, uncached vs through the cache
    const direct = {};
    for (const [name, fn] of [['trends', () => analytics.getTrends(opts)], ['peak', () => analytics.getPeakTimes(opts)], ['utilization', () => analytics.getStaffUtilization(opts)]]) {
      await cache.bump('analytics');
      const t0 = process.hrtime.bigint(); await cache.cached('analytics', name, 300, fn);
      const miss = Number(process.hrtime.bigint() - t0) / 1e6;
      const hits = [];
      for (let i = 0; i < 200; i += 1) {
        const t = process.hrtime.bigint(); await cache.cached('analytics', name, 300, fn);
        hits.push(Number(process.hrtime.bigint() - t) / 1e6);
      }
      direct[name] = { missMs: miss, hitMs: median(hits) };
    }

    // over HTTP (full request: auth, routing, JSON)
    const app = require('../src/app');
    const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    const base = `http://127.0.0.1:${server.address().port}/api/analytics`;
    const token = jwt.sign({ id: String(oid()), role: 'admin' }, process.env.JWT_SECRET);
    const range = `?from=${from}&to=${to}`;
    const http = {};
    for (const [name, p] of [['trends', `/trends${range}&interval=day`], ['peak-times', `/peak-times${range}`], ['staff-utilization', `/staff-utilization${range}`], ['summary', `/summary${range}`]]) {
      const timeIt = async (headers, n) => {
        const t = [];
        for (let i = 0; i < n; i += 1) {
          const s = process.hrtime.bigint();
          const r = await fetch(base + p, { headers: { Authorization: `Bearer ${token}`, ...headers } });
          await r.json();
          t.push(Number(process.hrtime.bigint() - s) / 1e6);
        }
        return t;
      };
      const nocache = await timeIt({ 'Cache-Control': 'no-cache' }, 10);
      await cache.bump('analytics');
      await timeIt({}, 1); // fills the cache
      const hit = await timeIt({}, 100);
      http[name] = { uncachedMs: median(nocache), cachedMs: median(hit) };
    }
    server.close();
    results[mode] = { direct, http };
  }
  return results;
}

// ---------- report ----------
function report(R) {
  const L = [];
  const cfgs = CONFIGS.map((c) => c.key);
  L.push('# Benchmark results', '');
  L.push(`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC by \`npm run benchmark\`.`, '');
  L.push(`- Machine: ${os.cpus()[0].model.trim()}, ${os.cpus().length} cores, ${(os.totalmem() / 1e9).toFixed(1)} GB RAM, Node ${process.version}`);
  L.push(`- MongoDB ${R.mongoVersion}, ${R.redis ? `Redis ${R.redis}` : 'no Redis'}, ${R.n.toLocaleString()} bookings (365 days back, 30 days ahead), 3 staff, 3 services`);
  L.push(`- Each query: 2 warm-up runs, then ${RUNS} timed runs; the table shows the **median** in milliseconds. Numbers on other machines will differ, the ratios should not.`, '');

  L.push('## 1. Query time by index setup (median ms)', '');
  L.push(`| Query | ${CONFIGS.map((c) => c.label).join(' | ')} | Speed-up A to C |`);
  L.push(`|---|${cfgs.map(() => '---:').join('|')}|---:|`);
  for (const id of Object.keys(R.queries.A)) {
    const a = R.queries.A[id].medianMs; const c = R.queries.C[id].medianMs;
    L.push(`| ${R.queries.A[id].name} | ${cfgs.map((k) => fmt(R.queries[k][id].medianMs)).join(' | ')} | ${(a / c).toFixed(1)}x |`);
  }
  L.push('', '## 2. How MongoDB answered each query (from `explain("executionStats")`)', '');
  L.push(`| Query | ${CONFIGS.map((c) => `${c.key}: plan / docs read`).join(' | ')} |`);
  L.push(`|---|${cfgs.map(() => '---').join('|')}|`);
  for (const id of Object.keys(R.queries.A)) {
    const cell = (k) => { const p = R.queries[k][id].plan; return `${p.scan}${p.covered ? ' (covered)' : ''} / ${p.docs?.toLocaleString()}`; };
    L.push(`| ${R.queries.A[id].name} | ${cfgs.map(cell).join(' | ')} |`);
  }
  L.push('', '"covered" = the answer came from the index alone, so no documents were read.', '');

  L.push(`## 3. MongoDB profiler: operations slower than ${SLOWMS} ms`, '');
  for (const cfg of ['A', 'B', 'C']) {
    const pr = R.profiler[cfg];
    L.push(`**Setup ${cfg}:** ${pr.supported ? `${pr.slow.length} slow operation(s)` : `profiler not available (${pr.reason})`}`, '');
    if (pr.supported && pr.slow.length) {
      L.push('| ms | Plan | Docs examined | Returned | Operation |', '|---:|---|---:|---:|---|');
      pr.slow.forEach((s) => L.push(`| ${s.millis} | ${s.plan} | ${s.docsExamined.toLocaleString()} | ${s.returned.toLocaleString()} | ${s.what} |`));
      L.push('');
    }
  }

  L.push('## 4. Cost of the indexes on writes', '');
  L.push('| Setup | Microseconds per insert (30,000 inserts) |', '|---|---:|');
  CONFIGS.forEach((c) => L.push(`| ${c.label} | ${R.writes[c.key].toFixed(1)} |`));
  L.push('');

  L.push('## 5. Cache: miss vs hit', '');
  if (!R.cache || Object.keys(R.cache).length === 0) L.push('(not measured yet)', '');
  for (const [mode, r] of Object.entries(R.cache || {})) {
    if (r.skipped) { L.push(`**${mode}:** skipped, ${r.skipped}`, ''); continue; }
    L.push(`### ${mode === 'redis' ? 'Redis' : 'In-memory fallback'}`, '');
    L.push('Aggregation through the cache (final indexes, 90 days):', '');
    L.push('| Query | First call (miss) ms | Cached call (hit) ms | Faster |', '|---|---:|---:|---:|');
    for (const [n, d] of Object.entries(r.direct)) L.push(`| ${n} | ${fmt(d.missMs)} | ${d.hitMs.toFixed(3)} | ${(d.missMs / d.hitMs).toFixed(0)}x |`);
    L.push('', 'Full HTTP request (token check, routing, JSON), median:', '');
    L.push('| Endpoint | No cache ms | Cached ms | Faster |', '|---|---:|---:|---:|');
    for (const [n, d] of Object.entries(r.http)) L.push(`| ${n} | ${fmt(d.uncachedMs)} | ${fmt(d.cachedMs)} | ${(d.uncachedMs / d.cachedMs).toFixed(1)}x |`);
    L.push('');
  }
  return L.join('\n');
}

// ---------- main ----------
// BENCH_STAGE=main  -> seed, query timings, profiler, write cost (keeps the database)
// BENCH_STAGE=cache -> cache measurements on the kept database
// default (all)     -> both, then removes the benchmark database
const STAGE = process.env.BENCH_STAGE || 'all';
const JSON_FILE = path.join(OUT, 'benchmark-results.json');

function save(R) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(JSON_FILE, JSON.stringify(R, null, 2));
  fs.writeFileSync(path.join(OUT, 'benchmark-results.md'), report(R));
  console.log('Saved docs/benchmark-results.md and .json');
}

(async () => {
  await mongoose.connect(URI);
  const db = mongoose.connection.db;
  const mongoVersion = (await db.admin().serverInfo()).version;
  let R;

  if (STAGE !== 'cache') {
    const data = await seed();
    if (process.env.BENCH_SEED_ONLY) { console.log('Seed only: database kept.'); await mongoose.disconnect(); process.exit(0); }
    const queries = buildQueries(data);
    R = { n: N, mongoVersion, redis: null, queries: {}, profiler: {}, writes: {}, cache: {} };
    for (const cfg of CONFIGS) {
      console.log(`\n== ${cfg.label}`);
      await applyIndexes(cfg);
      R.queries[cfg.key] = await measure(queries);
      R.profiler[cfg.key] = await profile(queries);
      for (const [id, r] of Object.entries(R.queries[cfg.key])) console.log(`  ${id.padEnd(15)} ${fmt(r.medianMs).padStart(8)} ms  ${r.plan.scan}${r.plan.covered ? ' (covered)' : ''}  docs=${r.plan.docs}`);
    }
    console.log('\n== write cost'); R.writes = await writeCost();
    save(R);
  } else {
    R = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
    await applyIndexes(CONFIGS[2]);
  }

  if (STAGE !== 'main') {
    if (process.env.REDIS_URL) {
      cache.init(process.env.REDIS_URL);
      await new Promise((r) => setTimeout(r, 800));
      R.redis = cache.mode() === 'redis' ? 'connected' : null;
    }
    console.log('\n== cache');
    R.cache = await cacheBench();
    save(R);
  }

  if (STAGE === 'all' && !process.env.BENCH_KEEP) await db.dropDatabase();
  await cache.close();
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
