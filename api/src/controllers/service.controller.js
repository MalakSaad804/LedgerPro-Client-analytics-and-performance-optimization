const Service = require('../models/Service');
const cache = require('../utils/cache');
const { isValidDateStr, getSlotsForDate, dayStartMs, DAY_MS } = require('../utils/slots');

// the public list is read far more often than it changes, so it is cached for 60 seconds
exports.list = async (req, res) => {
  const { value, status } = await cache.cached('services', 'active', 60, () =>
    Service.find({ isActive: true }).sort({ name: 1 }).lean()
  );
  res.set('X-Cache', status).json(value);
};

exports.create = async (req, res) => {
  const { name, description, durationMins, dailyCapacity } = req.body || {};
  const service = await Service.create({
    name, description, durationMins, dailyCapacity, createdBy: req.user.id,
  });
  cache.bump('services');
  res.status(201).json(service);
};

exports.update = async (req, res) => {
  const allowed = ['name', 'description', 'durationMins', 'dailyCapacity', 'isActive'];
  const updates = {};
  for (const key of allowed) if (req.body && key in req.body) updates[key] = req.body[key];
  const service = await Service.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
  if (!service) return res.status(404).json({ error: 'NOT_FOUND', message: 'Service not found' });
  cache.bump('services');
  res.json(service);
};

exports.remove = async (req, res) => {
  // soft delete keeps booking history intact
  const service = await Service.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
  if (!service) return res.status(404).json({ error: 'NOT_FOUND', message: 'Service not found' });
  cache.bump('services');
  res.json({ message: 'Service deactivated' });
};

// GET /api/services/:id/slots?date=YYYY-MM-DD
exports.slots = async (req, res) => {
  const { date } = req.query;
  if (!date || !isValidDateStr(date)) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'date query must be YYYY-MM-DD' });
  }
  const start = dayStartMs(date);
  if (start < Date.now() - DAY_MS || start > Date.now() + 60 * DAY_MS) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'date must be within the next 60 days' });
  }
  const service = await Service.findOne({ _id: req.params.id, isActive: true });
  if (!service) return res.status(404).json({ error: 'NOT_FOUND', message: 'Service not found' });

  const slots = await getSlotsForDate(service, date);
  res.json({
    service: service._id,
    date,
    slots: slots.map(({ start: s, label, available }) => ({ start: s, label, available })),
  });
};
