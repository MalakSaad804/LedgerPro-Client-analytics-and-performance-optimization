const Availability = require('../models/Availability');
const Booking = require('../models/Booking');

// Business time zone as minutes ahead of UTC (Pakistan = 300). Keeps slot labels
// the same for every viewer regardless of their device time zone.
const offsetMin = () => Number(process.env.BUSINESS_TZ_OFFSET_MIN ?? 300);
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n) => String(n).padStart(2, '0');

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

const isValidDateStr = (s) => {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

// UTC timestamp of local midnight (business time) for a YYYY-MM-DD string
const dayStartMs = (dateStr) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d) - offsetMin() * 60000;
};

const weekdayOf = (dateStr) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

const labelOf = (ms) => {
  const t = new Date(ms + offsetMin() * 60000);
  return `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
};

const dateStrOf = (ms) => new Date(ms + offsetMin() * 60000).toISOString().slice(0, 10);

// Pure function (no database): cut every staff working window into service-length
// slots, drop times where that staff member already has a booking, and list who is free.
//   windows:       [{ staff, startTime, endTime }]
//   staffBookings: [{ staff, startMs, endMs }]  non-cancelled bookings that day
function computeSlots({
  dateStr, durationMins, windows, staffBookings = [],
  serviceDayCount = 0, dailyCapacity = Infinity, now = Date.now(), onlyStaffId,
}) {
  const base = dayStartMs(dateStr);
  const durMs = durationMins * 60000;
  const slots = new Map(); // startMs -> [free staff ids]

  const load = new Map(); // bookings per staff that day, used to balance work
  for (const b of staffBookings) load.set(String(b.staff), (load.get(String(b.staff)) || 0) + 1);

  for (const w of windows) {
    const sid = String(w.staff);
    if (onlyStaffId && sid !== String(onlyStaffId)) continue;
    const mine = staffBookings.filter((b) => String(b.staff) === sid);
    for (let t = toMinutes(w.startTime); t + durationMins <= toMinutes(w.endTime); t += durationMins) {
      const start = base + t * 60000;
      const end = start + durMs;
      if (!slots.has(start)) slots.set(start, []);
      const busy = mine.some((b) => b.startMs < end && b.endMs > start);
      if (!busy) slots.get(start).push(sid);
    }
  }

  const dayFull = serviceDayCount >= dailyCapacity;
  return [...slots.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([startMs, free]) => {
      free.sort((a, b) => (load.get(a) || 0) - (load.get(b) || 0)); // least busy first
      return {
        startMs,
        start: new Date(startMs).toISOString(),
        label: labelOf(startMs),
        freeStaff: free,
        available: !dayFull && startMs > now && free.length > 0,
      };
    });
}

// Slots of a service on a date, using live data.
// options.onlyStaffId: only that staff member's own hours (used when rescheduling)
// options.excludeBookingId: ignore this booking (the one being moved)
async function getSlotsForDate(service, dateStr, options = {}) {
  const { onlyStaffId, excludeBookingId } = options;
  const windows = await Availability.find({ dayOfWeek: weekdayOf(dateStr) }).lean();

  const base = dayStartMs(dateStr);
  const dayFilter = {
    status: { $ne: 'cancelled' },
    slotStart: { $gte: new Date(base), $lt: new Date(base + DAY_MS) },
  };
  if (excludeBookingId) dayFilter._id = { $ne: excludeBookingId };

  const [rows, serviceDayCount] = await Promise.all([
    Booking.find({ ...dayFilter, staff: { $in: windows.map((w) => w.staff) } })
      .select('staff slotStart slotEnd').lean(),
    Booking.countDocuments({ ...dayFilter, service: service._id }),
  ]);

  const staffBookings = rows.map((b) => ({
    staff: b.staff,
    startMs: b.slotStart.getTime(),
    endMs: (b.slotEnd || new Date(b.slotStart.getTime() + 60 * 60000)).getTime(),
  }));

  return computeSlots({
    dateStr, durationMins: service.durationMins, windows, staffBookings,
    serviceDayCount, dailyCapacity: service.dailyCapacity, onlyStaffId,
  });
}

module.exports = {
  isValidDateStr, dateStrOf, dayStartMs, computeSlots, getSlotsForDate, DAY_MS,
};
