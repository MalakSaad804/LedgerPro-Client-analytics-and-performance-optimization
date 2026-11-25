const mongoose = require('mongoose');

// One working window per staff member per weekday (0 = Sunday ... 6 = Saturday).
// Times are "HH:MM" in the business time zone (see BUSINESS_TZ_OFFSET_MIN).
const availabilitySchema = new mongoose.Schema(
  {
    staff: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
    startTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    endTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
  },
  { timestamps: true }
);

availabilitySchema.index({ staff: 1, dayOfWeek: 1 }, { unique: true });
availabilitySchema.index({ dayOfWeek: 1 }); // slot generation looks up by weekday

module.exports = mongoose.model('Availability', availabilitySchema);
