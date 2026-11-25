const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Availability = require('../models/Availability');
const Service = require('../models/Service');
const User = require('../models/User');
const { dayStartMs, DAY_MS } = require('../utils/slots');

// "booked" = every status except cancelled
const ACTIVE = ['pending', 'confirmed', 'completed'];
const pad = (n) => String(n).padStart(2, '0');

// business time zone as "+05:00": aggregation stages use it so that
// "day", "hour" and "weekday" mean the same thing as in the office
const tzString = () => {
  const m = Number(process.env.BUSINESS_TZ_OFFSET_MIN ?? 300);
  const a = Math.abs(m);
  return `${m >= 0 ? '+' : '-'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
};

// scope.staffId set  -> only that staff member's bookings (DATA OWNERSHIP)
// scope.staffId null -> all bookings (admin)
// Note: aggregate() does NOT cast strings to ObjectId like find() does, so we do it here.
const scopeMatch = (scope) => (scope.staffId ? { staff: new mongoose.Types.ObjectId(scope.staffId) } : {});

const rangeFilter = (from, to) => ({
  $gte: new Date(dayStartMs(from)),
  $lt: new Date(dayStartMs(to) + DAY_MS),
});

const daysBetween = (from, to) => Math.round((dayStartMs(to) - dayStartMs(from)) / DAY_MS) + 1;

// ---------------------------------------------------------------------------
// Pipelines (plain functions, so the benchmark script can run AND explain them)
// ---------------------------------------------------------------------------

// Bookings per day / week / month, split into booked, completed and cancelled
function trendsPipeline({ scope, from, to, interval }) {
  const tz = tzString();
  const trunc = { date: '$slotStart', unit: interval, timezone: tz };
  if (interval === 'week') trunc.startOfWeek = 'monday';
  return [
    { $match: { ...scopeMatch(scope), slotStart: rangeFilter(from, to) } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', timezone: tz, date: { $dateTrunc: trunc } } },
        booked: { $sum: { $cond: [{ $ne: ['$status', 'cancelled'] }, 1, 0] } },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
      },
    },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, period: '$_id', booked: 1, completed: 1, cancelled: 1 } },
  ];
}

// How many bookings start in each (weekday, hour) cell
function peakPipeline({ scope, from, to }) {
  const tz = tzString();
  return [
    { $match: { ...scopeMatch(scope), status: { $in: ACTIVE }, slotStart: rangeFilter(from, to) } },
    {
      $group: {
        _id: {
          dow: { $dayOfWeek: { date: '$slotStart', timezone: tz } }, // 1 = Sunday ... 7 = Saturday
          hour: { $hour: { date: '$slotStart', timezone: tz } },
        },
        count: { $sum: 1 },
      },
    },
  ];
}

// Per staff member: bookings and booked minutes (cancelled ones do not use up time)
function utilizationPipeline({ scope, from, to }) {
  return [
    { $match: { ...scopeMatch(scope), slotStart: rangeFilter(from, to) } },
    {
      $group: {
        _id: '$staff',
        bookings: { $sum: { $cond: [{ $ne: ['$status', 'cancelled'] }, 1, 0] } },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
        bookedMinutes: {
          $sum: {
            $cond: [
              { $ne: ['$status', 'cancelled'] },
              { $divide: [{ $subtract: [{ $ifNull: ['$slotEnd', { $add: ['$slotStart', 3600000] }] }, '$slotStart'] }, 60000] },
              0,
            ],
          },
        },
      },
    },
  ];
}

// KPI numbers in ONE pass over the matching bookings ($facet runs three sub-pipelines on it)
function summaryPipeline({ scope, from, to }) {
  const tz = tzString();
  return [
    { $match: { ...scopeMatch(scope), slotStart: rangeFilter(from, to) } },
    {
      $facet: {
        byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
        topServices: [
          { $match: { status: { $in: ACTIVE } } },
          { $group: { _id: '$service', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 5 },
          { $lookup: { from: Service.collection.name, localField: '_id', foreignField: '_id', as: 'svc' } },
          { $project: { _id: 0, name: { $ifNull: [{ $arrayElemAt: ['$svc.name', 0] }, 'Unknown'] }, count: 1 } },
        ],
        busiestDay: [
          { $match: { status: { $in: ACTIVE } } },
          { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$slotStart', timezone: tz } }, count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 1 },
        ],
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Service functions: run a pipeline, then shape the result for the API
// ---------------------------------------------------------------------------

const dateAdd = (dateStr, n) => new Date(Date.UTC(...dateStr.split('-').map((v, i) => (i === 1 ? Number(v) - 1 : Number(v))), 0) + n * DAY_MS)
  .toISOString().slice(0, 10);

async function getTrends(opts) {
  const rows = await Booking.aggregate(trendsPipeline(opts));
  if (opts.interval !== 'day') return { interval: opts.interval, points: rows };

  // fill days without bookings with zeros so the chart has no gaps
  const byDay = new Map(rows.map((r) => [r.period, r]));
  const points = [];
  for (let i = 0; i < daysBetween(opts.from, opts.to); i += 1) {
    const day = dateAdd(opts.from, i);
    points.push(byDay.get(day) || { period: day, booked: 0, completed: 0, cancelled: 0 });
  }
  return { interval: 'day', points };
}

async function getPeakTimes(opts) {
  const rows = await Booking.aggregate(peakPipeline(opts));
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0)); // grid[weekday 0=Sun][hour]
  for (const r of rows) grid[r._id.dow - 1][r._id.hour] = r.count;

  const byHour = Array(24).fill(0);
  const byWeekday = Array(7).fill(0);
  const cells = [];
  grid.forEach((hours, d) => hours.forEach((count, h) => {
    byHour[h] += count;
    byWeekday[d] += count;
    if (count > 0) cells.push({ weekday: d, hour: h, count });
  }));
  const topSlots = cells.sort((a, b) => b.count - a.count).slice(0, 5);
  return { grid, byHour, byWeekday, topSlots, total: byHour.reduce((a, b) => a + b, 0) };
}

// working minutes of each staff member inside the date range
async function availableMinutes(scope, from, to) {
  const windows = await Availability.find(scope.staffId ? { staff: scope.staffId } : {}).lean();
  const weekdayCount = Array(7).fill(0);
  for (let i = 0; i < daysBetween(from, to); i += 1) {
    weekdayCount[new Date(`${dateAdd(from, i)}T00:00:00Z`).getUTCDay()] += 1;
  }
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const result = new Map();
  for (const w of windows) {
    const minutes = (toMin(w.endTime) - toMin(w.startTime)) * weekdayCount[w.dayOfWeek];
    result.set(String(w.staff), (result.get(String(w.staff)) || 0) + minutes);
  }
  return result;
}

async function getStaffUtilization(opts) {
  const [rows, available] = await Promise.all([
    Booking.aggregate(utilizationPipeline(opts)),
    availableMinutes(opts.scope, opts.from, opts.to),
  ]);
  const booked = new Map(rows.filter((r) => r._id).map((r) => [String(r._id), r]));
  const ids = [...new Set([...booked.keys(), ...available.keys()])];
  const users = await User.find({ _id: { $in: ids } }).select('name').lean();
  const names = new Map(users.map((u) => [String(u._id), u.name]));

  const staff = ids.map((id) => {
    const b = booked.get(id) || { bookings: 0, completed: 0, cancelled: 0, bookedMinutes: 0 };
    const availableMins = available.get(id) || 0;
    return {
      staffId: id,
      name: names.get(id) || 'Unknown',
      bookings: b.bookings,
      completed: b.completed,
      cancelled: b.cancelled,
      bookedMinutes: Math.round(b.bookedMinutes),
      availableMinutes: availableMins,
      utilization: availableMins > 0 ? Math.min(1, b.bookedMinutes / availableMins) : 0,
    };
  }).sort((a, b) => b.utilization - a.utilization);
  return { staff };
}

async function getSummary(opts) {
  const [facets] = await Booking.aggregate(summaryPipeline(opts));
  const count = (s) => facets.byStatus.find((x) => x._id === s)?.count || 0;
  const total = facets.byStatus.reduce((sum, x) => sum + x.count, 0);
  const cancelled = count('cancelled');
  const active = total - cancelled;
  return {
    total,
    active,
    cancelled,
    completed: count('completed'),
    cancellationRate: total ? cancelled / total : 0,
    avgPerDay: active / daysBetween(opts.from, opts.to),
    busiestDay: facets.busiestDay[0] ? { date: facets.busiestDay[0]._id, count: facets.busiestDay[0].count } : null,
    topServices: facets.topServices,
  };
}

module.exports = {
  ACTIVE, tzString, daysBetween,
  trendsPipeline, peakPipeline, utilizationPipeline, summaryPipeline,
  getTrends, getPeakTimes, getStaffUtilization, getSummary,
};
