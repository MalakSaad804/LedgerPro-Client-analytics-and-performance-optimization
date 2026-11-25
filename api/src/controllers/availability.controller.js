const Availability = require('../models/Availability');
const cache = require('../utils/cache');

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// staff: view own weekly availability
exports.mine = async (req, res) => {
  const rows = await Availability.find({ staff: req.user.id }).sort({ dayOfWeek: 1 });
  res.json(rows);
};

// staff: replace own weekly availability. Body: { days: [{ dayOfWeek, startTime, endTime }] }
exports.replaceMine = async (req, res) => {
  const { days } = req.body || {};
  if (!Array.isArray(days) || days.length > 7) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'days must be an array of up to 7 items' });
  }
  const seen = new Set();
  for (const d of days) {
    const ok =
      Number.isInteger(d.dayOfWeek) && d.dayOfWeek >= 0 && d.dayOfWeek <= 6 &&
      TIME_RE.test(d.startTime) && TIME_RE.test(d.endTime) && d.startTime < d.endTime;
    if (!ok || seen.has(d.dayOfWeek)) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Each day needs a unique dayOfWeek (0-6) and startTime < endTime (HH:MM)' });
    }
    seen.add(d.dayOfWeek);
  }
  await Availability.deleteMany({ staff: req.user.id });
  const rows = await Availability.insertMany(days.map((d) => ({ ...d, staff: req.user.id })));
  cache.bump('analytics'); // working hours changed: utilization numbers change
  res.json(rows);
};
