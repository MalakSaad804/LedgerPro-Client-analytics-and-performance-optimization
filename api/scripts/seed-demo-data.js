/* Fills the database with realistic DEMO bookings so the analytics charts have something to show.
 *   npm run seed       (first: creates admin, 2 staff, services)
 *   npm run seed:demo  (then: ~60 days of history + next 14 days)
 * Safe to run again: it replaces its own demo bookings. Demo customers use @ledgerpro.test emails.
 */
require('dotenv').config();
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Service = require('../src/models/Service');
const Availability = require('../src/models/Availability');
const Booking = require('../src/models/Booking');
const cache = require('../src/utils/cache');

const DAY = 86400000;
const OFFSET_MIN = Number(process.env.BUSINESS_TZ_OFFSET_MIN ?? 300);
// deterministic random numbers, so everybody gets the same demo data
let seed = 7;
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

// busier around 10-11 and 14-15, quieter at lunch and late afternoon
const HOUR_WEIGHT = { 9: 0.35, 10: 0.7, 11: 0.65, 12: 0.2, 13: 0.25, 14: 0.6, 15: 0.55, 16: 0.3, 17: 0.1 };

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const services = await Service.find({ isActive: true });
  const windows = await Availability.find().lean();
  if (!services.length || !windows.length) {
    console.error('Run "npm run seed" first (it creates staff, working hours and services).');
    process.exit(1);
  }

  // demo customers
  const customers = [];
  for (let i = 1; i <= 12; i += 1) {
    const email = `demo.customer${i}@ledgerpro.test`;
    let u = await User.findOne({ email });
    if (!u) u = await User.create({ name: `Demo Customer ${i}`, email, password: await bcrypt.hash('Demo@12345', 10) });
    customers.push(u);
  }
  const removed = await Booking.deleteMany({ customer: { $in: customers.map((c) => c._id) } });

  const docs = [];
  const now = Date.now();
  // keep real ObjectIds: insertMany on the raw collection does not convert strings for us
  const staffIds = [...new Map(windows.map((w) => [String(w.staff), w.staff])).values()];

  for (let d = -60; d <= 14; d += 1) {
    const dayBase = now + d * DAY;
    const local = new Date(dayBase + OFFSET_MIN * 60000);
    const dow = local.getUTCDay();
    const midnightUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - OFFSET_MIN * 60000;

    for (const sid of staffIds) {
      const w = windows.find((x) => String(x.staff) === String(sid) && x.dayOfWeek === dow);
      if (!w) continue; // not working that day
      const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
      let cursor = toMin(w.startTime);
      const end = toMin(w.endTime);
      while (cursor < end) {
        const hour = Math.floor(cursor / 60);
        if (rand() < (HOUR_WEIGHT[hour] ?? 0.2)) {
          const svc = services[Math.floor(rand() * services.length)];
          if (cursor + svc.durationMins <= end) {
            const start = new Date(midnightUtc + cursor * 60000);
            const past = start.getTime() < now;
            const r = rand();
            const status = past ? (r < 0.72 ? 'completed' : r < 0.86 ? 'cancelled' : 'confirmed')
              : (r < 0.88 ? 'confirmed' : r < 0.95 ? 'pending' : 'cancelled');
            docs.push({
              customer: customers[Math.floor(rand() * customers.length)]._id,
              service: svc._id, staff: sid, slotStart: start,
              slotEnd: new Date(start.getTime() + svc.durationMins * 60000), status,
              createdAt: new Date(start.getTime() - 3 * DAY), updatedAt: start,
            });
            cursor += svc.durationMins; // no overlaps for the same staff member
            continue;
          }
        }
        cursor += 30;
      }
    }
  }

  await Booking.collection.insertMany(docs);
  console.log(`Removed ${removed.deletedCount} old demo bookings, created ${docs.length} demo bookings (60 days back, 14 ahead).`);

  // make cached analytics fresh (works for Redis; an in-memory cache inside the running API expires in 5 minutes)
  if (process.env.REDIS_URL) {
    cache.init(process.env.REDIS_URL);
    await new Promise((r) => setTimeout(r, 500));
    await cache.bump('analytics');
    await cache.close();
  }
  await mongoose.disconnect();
})();
