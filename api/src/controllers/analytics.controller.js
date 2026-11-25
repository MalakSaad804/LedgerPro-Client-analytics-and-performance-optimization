const cache = require('../utils/cache');
const analytics = require('../services/analytics.service');
const { isValidDateStr, dateStrOf, dayStartMs, DAY_MS } = require('../utils/slots');

const TTL_SECONDS = 300; // cached results also vanish immediately when a booking changes (see cache.bump)
const MAX_RANGE_DAYS = 400;
const INTERVALS = ['day', 'week', 'month'];

// DATA OWNERSHIP: staff only ever get numbers about their own bookings; admins see everyone.
const scopeOf = (req) => ({ staffId: req.user.role === 'admin' ? null : req.user.id });

function parseRange(query) {
  const from = query.from ?? dateStrOf(Date.now() - 30 * DAY_MS);
  const to = query.to ?? dateStrOf(Date.now() + 14 * DAY_MS);
  if (!isValidDateStr(from) || !isValidDateStr(to)) return { error: 'from and to must be dates like 2026-11-24' };
  if (from > to) return { error: 'from must not be after to' };
  if ((dayStartMs(to) - dayStartMs(from)) / DAY_MS > MAX_RANGE_DAYS) return { error: `range cannot be longer than ${MAX_RANGE_DAYS} days` };
  return { from, to };
}

// one handler for all four endpoints: validate, look in the cache, otherwise run the pipeline
const endpoint = (name, compute, extra = () => ({})) => async (req, res) => {
  const range = parseRange(req.query);
  if (range.error) return res.status(400).json({ error: 'VALIDATION_ERROR', message: range.error });
  const more = extra(req);
  if (more.error) return res.status(400).json({ error: 'VALIDATION_ERROR', message: more.error });

  const scope = scopeOf(req);
  const opts = { scope, ...range, ...more.opts };
  const key = [scope.staffId || 'all', name, range.from, range.to, more.opts?.interval || ''].join(':');
  const bypass = /no-cache/i.test(req.headers['cache-control'] || '');

  const { value, status } = await cache.cached('analytics', key, TTL_SECONDS, () => compute(opts), { bypass });
  res.set('X-Cache', status).json({ range, scope: scope.staffId ? 'own' : 'all', ...value });
};

exports.summary = endpoint('summary', analytics.getSummary);
exports.peakTimes = endpoint('peak', analytics.getPeakTimes);
exports.staffUtilization = endpoint('utilization', analytics.getStaffUtilization);
exports.trends = endpoint('trends', analytics.getTrends, (req) => {
  const interval = req.query.interval ?? 'day';
  if (!INTERVALS.includes(interval)) return { error: `interval must be one of ${INTERVALS.join(', ')}` };
  return { opts: { interval } };
});
