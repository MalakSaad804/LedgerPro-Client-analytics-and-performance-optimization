const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Service = require('../models/Service');
const { getSlotsForDate, dateStrOf } = require('../utils/slots');
const { bookingChanged } = require('../utils/bookingEvents');

// customer: only their own bookings
exports.myBookings = async (req, res) => {
  const bookings = await Booking.find({ customer: req.user.id })
    .sort({ slotStart: -1 })
    .populate('service', 'name durationMins')
    .populate('staff', 'name');
  res.json(bookings);
};

// customer: create a booking for a valid, free slot. The API assigns a staff member.
exports.create = async (req, res) => {
  const { serviceId, slotStart, notes } = req.body || {};
  if (!serviceId || !mongoose.isValidObjectId(serviceId) || !slotStart) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'serviceId and slotStart are required' });
  }
  if (notes && String(notes).length > 300) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'notes must be 300 characters or less' });
  }
  const start = new Date(slotStart);
  if (Number.isNaN(start.getTime())) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'slotStart is not a valid date' });
  }
  const service = await Service.findOne({ _id: serviceId, isActive: true });
  if (!service) return res.status(404).json({ error: 'NOT_FOUND', message: 'Service not found' });

  // never trust the client: re-check the slot against live availability
  const slots = await getSlotsForDate(service, dateStrOf(start.getTime()));
  const slot = slots.find((s) => s.startMs === start.getTime());
  if (!slot) return res.status(400).json({ error: 'INVALID_SLOT', message: 'That time is not offered for this service' });
  if (!slot.available) return res.status(409).json({ error: 'SLOT_TAKEN', message: 'That slot is no longer available' });

  const booking = await Booking.create({
    customer: req.user.id,
    service: service._id,
    staff: slot.freeStaff[0], // least busy staff member who is free at that time
    slotStart: start,
    slotEnd: new Date(start.getTime() + service.durationMins * 60000),
    status: 'confirmed',
    notes: notes ? String(notes).trim() : undefined,
  });
  bookingChanged(booking, 'created');
  res.status(201).json(booking);
};

// customer: cancel own booking
exports.cancel = async (req, res) => {
  const booking = await Booking.findOne({ _id: req.params.id, customer: req.user.id });
  if (!booking) return res.status(404).json({ error: 'NOT_FOUND', message: 'Booking not found' });
  booking.status = 'cancelled';
  await booking.save();
  bookingChanged(booking, 'cancelled');
  res.json(booking);
};
