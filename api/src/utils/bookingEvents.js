const { emitBookingChange } = require('../realtime');
const cache = require('./cache');

// One call for everything that must happen when a booking changes:
// 1) tell the staff dashboard (Socket.IO), 2) invalidate cached analytics.
function bookingChanged(booking, action) {
  cache.bump('analytics');
  emitBookingChange(booking, action);
}

module.exports = { bookingChanged };
