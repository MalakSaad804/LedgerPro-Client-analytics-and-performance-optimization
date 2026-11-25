// Integration tests for the analytics module. They need a local MongoDB
// (default mongodb://127.0.0.1:27017/ledgerpro_test, override with TEST_MONGO_URI).
// They use a small dataset with numbers worked out by hand, so every figure is checkable.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'test-secret';
process.env.BUSINESS_TZ_OFFSET_MIN = '300'; // Pakistan, UTC+5

const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const cache = require('../src/utils/cache');
const app = require('../src/app');
const User = require('../src/models/User');
const Booking = require('../src/models/Booking');
const Availability = require('../src/models/Availability');
const Service = require('../src/models/Service');
const { trendsPipeline } = require('../src/services/analytics.service');

let server; let base; let A; let B; let admin; let service; let tokenA; let tokenB; let tokenAdmin; let tokenCustomer;
const get = async (path, token, headers = {}) => {
  const res = await fetch(base + path, { headers: { Authorization: `Bearer ${token}`, ...headers } });
  return { status: res.status, cache: res.headers.get('x-cache'), body: await res.json() };
};
// local office time (UTC+5) -> UTC date
const at = (day, hh, mm = 0) => new Date(Date.UTC(2026, 10, day, hh - 5, mm));
const RANGE = '?from=2026-11-02&to=2026-11-06'; // Monday to Friday

before(async () => {
  await mongoose.connect(process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017/ledgerpro_test');
  await mongoose.connection.dropDatabase();
  await Booking.syncIndexes();
  cache.init(process.env.TEST_REDIS_URL); // memory mode unless a Redis URL is given

  [A, B, admin] = await User.create([
    { name: 'Ayesha', email: 'a@x.com', password: 'x', role: 'staff' },
    { name: 'Bilal', email: 'b@x.com', password: 'x', role: 'staff' },
    { name: 'Admin', email: 'admin@x.com', password: 'x', role: 'admin' },
  ]);
  const customer = await User.create({ name: 'Sara', email: 's@x.com', password: 'x' });
  service = await Service.create({ name: 'Tax', durationMins: 60, createdBy: admin._id });

  // Ayesha works Mon-Fri 09:00-17:00 (480 min/day), Bilal Mon-Fri 10:00-14:00 (240 min/day)
  const days = [1, 2, 3, 4, 5];
  await Availability.insertMany([
    ...days.map((d) => ({ staff: A._id, dayOfWeek: d, startTime: '09:00', endTime: '17:00' })),
    ...days.map((d) => ({ staff: B._id, dayOfWeek: d, startTime: '10:00', endTime: '14:00' })),
  ]);

  const mk = (staff, day, h, m, mins, status) => ({
    customer: customer._id, service: service._id, staff: staff._id,
    slotStart: at(day, h, m), slotEnd: at(day, h, m + mins), status,
  });
  await Booking.insertMany([
    mk(A, 2, 9, 0, 60, 'confirmed'),   // Mon
    mk(A, 2, 10, 0, 90, 'completed'),  // Mon, 90 minutes
    mk(A, 3, 9, 0, 60, 'cancelled'),   // Tue, cancelled: must not count as busy time
    mk(A, 4, 14, 0, 60, 'pending'),    // Wed
    mk(B, 2, 10, 0, 60, 'confirmed'),  // Mon
    mk(B, 3, 10, 0, 60, 'completed'),  // Tue
    mk(B, 4, 10, 0, 60, 'confirmed'),  // Wed
  ]);

  const sign = (u, role) => jwt.sign({ id: String(u._id), role }, process.env.JWT_SECRET);
  tokenA = sign(A, 'staff'); tokenB = sign(B, 'staff'); tokenAdmin = sign(admin, 'admin'); tokenCustomer = sign(customer, 'customer');

  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/analytics`;
});

after(async () => {
  server?.close();
  await cache.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('summary: totals, cancellation rate, busiest day, top services', async () => {
  const { status, body } = await get(`/summary${RANGE}`, tokenAdmin);
  assert.equal(status, 200);
  assert.equal(body.total, 7);
  assert.equal(body.active, 6);
  assert.equal(body.cancelled, 1);
  assert.equal(body.completed, 2);
  assert.ok(Math.abs(body.cancellationRate - 1 / 7) < 1e-9);
  assert.deepEqual(body.busiestDay, { date: '2026-11-02', count: 3 });
  assert.deepEqual(body.topServices, [{ name: 'Tax', count: 6 }]);
});

test('trends (day): counts per day and zero-filled gaps', async () => {
  const { body } = await get(`/trends${RANGE}&interval=day`, tokenAdmin);
  const byDay = Object.fromEntries(body.points.map((p) => [p.period, p]));
  assert.equal(body.points.length, 5);
  assert.deepEqual(byDay['2026-11-02'], { period: '2026-11-02', booked: 3, completed: 1, cancelled: 0 });
  assert.deepEqual(byDay['2026-11-03'], { period: '2026-11-03', booked: 1, completed: 1, cancelled: 1 });
  assert.deepEqual(byDay['2026-11-04'], { period: '2026-11-04', booked: 2, completed: 0, cancelled: 0 });
  assert.deepEqual(byDay['2026-11-05'], { period: '2026-11-05', booked: 0, completed: 0, cancelled: 0 });
});

test('trends (week): one Monday-based bucket', async () => {
  const { body } = await get(`/trends${RANGE}&interval=week`, tokenAdmin);
  assert.deepEqual(body.points, [{ period: '2026-11-02', booked: 6, completed: 2, cancelled: 1 }]);
});

test('peak times: finds 10:00 as the busiest hour, uses office time zone', async () => {
  const { body } = await get(`/peak-times${RANGE}`, tokenAdmin);
  assert.equal(body.total, 6);
  assert.equal(body.byHour[10], 4); // Mon A, Mon B, Tue B, Wed B
  assert.equal(body.byHour[9], 1);  // the cancelled 09:00 booking is not counted
  assert.equal(body.byHour[14], 1);
  assert.deepEqual(body.topSlots[0], { weekday: 1, hour: 10, count: 2 }); // Monday 10:00
  assert.equal(body.byWeekday[1], 3); // Monday
});

test('staff utilization: booked minutes / working minutes', async () => {
  const { body } = await get(`/staff-utilization${RANGE}`, tokenAdmin);
  const a = body.staff.find((s) => s.name === 'Ayesha');
  const b = body.staff.find((s) => s.name === 'Bilal');
  assert.equal(a.bookedMinutes, 210);      // 60 + 90 + 60 (cancelled booking excluded)
  assert.equal(a.availableMinutes, 2400);  // 5 days x 480
  assert.ok(Math.abs(a.utilization - 210 / 2400) < 1e-9);
  assert.equal(a.cancelled, 1);
  assert.equal(b.bookedMinutes, 180);
  assert.equal(b.availableMinutes, 1200);
  assert.ok(Math.abs(b.utilization - 0.15) < 1e-9);
  assert.equal(body.staff[0].name, 'Bilal'); // sorted by utilization, highest first
});

test('data ownership: staff only see their own numbers, admin sees all', async () => {
  const own = await get(`/staff-utilization${RANGE}`, tokenA);
  assert.equal(own.body.scope, 'own');
  assert.deepEqual(own.body.staff.map((s) => s.name), ['Ayesha']);

  const trends = await get(`/trends${RANGE}&interval=week`, tokenA);
  assert.deepEqual(trends.body.points, [{ period: '2026-11-02', booked: 3, completed: 1, cancelled: 1 }]);

  const peak = await get(`/peak-times${RANGE}`, tokenB);
  assert.equal(peak.body.total, 3); // Bilal has 3 bookings

  const all = await get(`/staff-utilization${RANGE}`, tokenAdmin);
  assert.equal(all.body.scope, 'all');
  assert.equal(all.body.staff.length, 2);
});

test('access rules and validation', async () => {
  assert.equal((await get(`/summary${RANGE}`, tokenCustomer)).status, 403);
  assert.equal((await fetch(`${base}/summary`)).status, 401);
  assert.equal((await get('/summary?from=banana&to=2026-11-06', tokenAdmin)).status, 400);
  assert.equal((await get('/summary?from=2026-11-06&to=2026-11-02', tokenAdmin)).status, 400);
  assert.equal((await get('/trends?interval=hour', tokenAdmin)).status, 400);
  assert.equal((await get('/summary?from=2020-01-01&to=2026-11-02', tokenAdmin)).status, 400); // longer than 400 days
});

test('cache: MISS, then HIT, then MISS again after a booking changes, BYPASS on demand', async () => {
  const path = `/trends${RANGE}&interval=day`;
  cache.stats.hits = 0; cache.stats.misses = 0;
  await cache.bump('analytics'); // start clean
  assert.equal((await get(path, tokenAdmin)).cache, 'MISS');
  assert.equal((await get(path, tokenAdmin)).cache, 'HIT');
  assert.equal((await get(path, tokenAdmin, { 'Cache-Control': 'no-cache' })).cache, 'BYPASS');

  // a new booking must be visible straight away (the cache is invalidated)
  const { bookingChanged } = require('../src/utils/bookingEvents');
  const extra = await Booking.create({
    customer: A._id, service: service._id, staff: B._id,
    slotStart: at(5, 11), slotEnd: at(5, 12), status: 'confirmed',
  });
  bookingChanged(extra, 'created');
  const after = await get(path, tokenAdmin);
  assert.equal(after.cache, 'MISS');
  assert.equal(after.body.points.find((p) => p.period === '2026-11-05').booked, 1);
  await Booking.deleteOne({ _id: extra._id });
  await cache.bump('analytics');

  // each person has their own cache entry: staff never receive the admin's numbers
  const a1 = await get(path, tokenA);
  assert.equal(a1.body.scope, 'own');
  assert.equal(a1.cache, 'MISS');
});

test('indexes: admin and staff analytics are answered from an index (0 documents read)', async () => {
  const mk = (scope) => Booking.aggregate(trendsPipeline({ scope, from: '2026-11-02', to: '2026-11-06', interval: 'day' }))
    .explain('executionStats');
  const find = (o, key) => { // search the explain output for a key, whatever its depth
    if (!o || typeof o !== 'object') return undefined;
    if (key in o) return o[key];
    for (const v of Object.values(o)) { const r = find(v, key); if (r !== undefined) return r; }
    return undefined;
  };
  for (const scope of [{ staffId: null }, { staffId: String(A._id) }]) {
    const ex = await mk(scope);
    const text = JSON.stringify(ex);
    assert.ok(text.includes('IXSCAN'), 'expected an index scan');
    assert.ok(!text.includes('COLLSCAN'), 'must not scan the whole collection');
    assert.equal(find(ex, 'totalDocsExamined'), 0, 'covered query reads no documents');
  }
});
