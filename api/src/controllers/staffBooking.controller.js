const Booking = require('../models/Booking');
const Service = require('../models/Service');
const { isValidDateStr, dateStrOf, getSlotsForDate } = require('../utils/slots');
const { bookingChanged } = require('../utils/bookingEvents');

const STATUSES = ['pending', 'confirmed', 'completed', 'cancelled'];
const CLOSED = ['cancelled', 'completed'];
const DEFAULT_WINDOW_DAYS = 60;
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 2000;

// DATA OWNERSHIP: every query below goes through this filter.
// A staff member can only reach bookings where booking.staff is their own id.
// Admins (managers) can reach all bookings.
const ownerFilter = (req) => (req.user.role === 'admin' ? {} : { staff: req.user.id });

const withDetails = (query) =>
  query
    .populate('customer', 'name email')
    .populate('service', 'name durationMins')
    .populate('staff', 'name');

const notFound = (res) => res.status(404).json({ error: 'NOT_FOUND', message: 'Booking not found' });

// GET /api/staff/bookings?status=&from=&to=
exports.list = async (req, res) => {
  const filter = ownerFilter(req);
  const { status, from, to } = req.query;

  if (status !== undefined) {
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: `status must be one of ${STATUSES.join(', ')}` });
    }
    filter.status = status;
  }
  // PERFORMANCE: never return a staff member's whole history by default.
  // Without ?from the list starts 60 days ago; results are capped by ?limit (default 1000, max 2000).
  if (req.query.from === undefined) filter.slotStart = { $gte: new Date(Date.now() - DEFAULT_WINDOW_DAYS * 86400000) };
  for (const [key, op] of [['from', '$gte'], ['to', '$lte']]) {
    const raw = req.query[key];
    if (raw === undefined) continue;
    const d = typeof raw === 'string' ? new Date(raw) : new Date(NaN);
    if (Number.isNaN(d.getTime())) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: `${key} must be a valid date` });
    }
    filter.slotStart = { ...filter.slotStart, [op]: d };
  }

  const rawLimit = Number(req.query.limit);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : DEFAULT_LIMIT;
  res.json(await withDetails(Booking.find(filter).sort({ slotStart: 1 }).limit(limit)));
};

// GET /api/staff/bookings/:id
exports.getOne = async (req, res) => {
  const booking = await withDetails(Booking.findOne({ _id: req.params.id, ...ownerFilter(req) }));
  if (!booking) return notFound(res);
  res.json(booking);
};

// PATCH /api/staff/bookings/:id   body: { status?, staffNotes?, slotStart? }
exports.update = async (req, res) => {
  const booking = await Booking.findOne({ _id: req.params.id, ...ownerFilter(req) });
  if (!booking) return notFound(res); // also returned for other staff's bookings: no hint they exist
  if (CLOSED.includes(booking.status)) {
    return res.status(409).json({ error: 'BOOKING_CLOSED', message: `A ${booking.status} booking cannot be changed` });
  }

  const { status, staffNotes, slotStart } = req.body || {};
  let action = 'updated';

  if (status !== undefined) {
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: `status must be one of ${STATUSES.join(', ')}` });
    }
    booking.status = status;
    if (status === 'cancelled') action = 'cancelled';
  }

  if (staffNotes !== undefined) {
    if (typeof staffNotes !== 'string' || staffNotes.length > 500) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'staffNotes must be text up to 500 characters' });
    }
    booking.staffNotes = staffNotes.trim();
  }

  // reschedule: the new time must be a free slot inside THIS staff member's working hours
  if (slotStart !== undefined && booking.status !== 'cancelled') {
    const start = new Date(slotStart);
    if (Number.isNaN(start.getTime())) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'slotStart is not a valid date' });
    }
    if (start.getTime() !== booking.slotStart.getTime()) {
      const service = await Service.findById(booking.service);
      const slots = await getSlotsForDate(service, dateStrOf(start.getTime()), {
        onlyStaffId: booking.staff,
        excludeBookingId: booking._id,
      });
      const slot = slots.find((s) => s.startMs === start.getTime());
      if (!slot || !slot.available) {
        return res.status(409).json({ error: 'SLOT_TAKEN', message: 'That time is not free in your schedule' });
      }
      booking.slotStart = start;
      booking.slotEnd = new Date(start.getTime() + service.durationMins * 60000);
      action = 'rescheduled';
    }
  }

  await booking.save();
  bookingChanged(booking, action);
  res.json(await withDetails(Booking.findById(booking._id)));
};

// GET /api/staff/bookings/:id/slots?date=YYYY-MM-DD  (free times for moving this booking)
exports.slotsForBooking = async (req, res) => {
  const { date } = req.query;
  if (!isValidDateStr(date)) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'date query must be YYYY-MM-DD' });
  }
  const booking = await Booking.findOne({ _id: req.params.id, ...ownerFilter(req) });
  if (!booking) return notFound(res);
  const service = await Service.findById(booking.service);
  const slots = await getSlotsForDate(service, date, {
    onlyStaffId: booking.staff,
    excludeBookingId: booking._id,
  });
  res.json({
    date,
    slots: slots.map(({ start, label, available }) => ({ start, label, available })),
  });
};
