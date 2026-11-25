const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
    // the staff member (accountant) this booking is assigned to: used for data ownership
    staff: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    slotStart: { type: Date, required: true },
    slotEnd: { type: Date },
    status: { type: String, enum: ['pending', 'confirmed', 'completed', 'cancelled'], default: 'pending' },
    notes: { type: String, trim: true, maxlength: 300 }, // written by the customer
    staffNotes: { type: String, trim: true, maxlength: 500 }, // written by staff
  },
  { timestamps: true }
);

// "my bookings" for a customer, newest first
bookingSchema.index({ customer: 1, slotStart: -1 });
// capacity check per service per day
bookingSchema.index({ service: 1, slotStart: 1, status: 1 });
// staff dashboard list, clash checks and staff-scoped analytics.
// Wide on purpose: it also contains status and slotEnd, so analytics can be answered
// from the index alone ("covered query") without reading the documents.
// It replaces the older { staff, slotStart } index, which is a prefix of this one.
bookingSchema.index({ staff: 1, slotStart: 1, status: 1, slotEnd: 1 });
// analytics across all staff (admin): range on slotStart, covered as well
bookingSchema.index({ slotStart: 1, status: 1, staff: 1, slotEnd: 1 });

module.exports = mongoose.model('Booking', bookingSchema);
