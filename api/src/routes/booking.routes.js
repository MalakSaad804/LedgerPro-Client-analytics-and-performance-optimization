const router = require('express').Router();
const c = require('../controllers/booking.controller');
const s = require('../controllers/staffBooking.controller');
const a = require('../controllers/availability.controller');
const { protect } = require('../middleware/auth');
const { allow } = require('../middleware/role');

// customer
router.get('/customer/bookings', protect, allow('customer'), c.myBookings);
router.post('/customer/bookings', protect, allow('customer'), c.create);
router.patch('/customer/bookings/:id/cancel', protect, allow('customer'), c.cancel);

// staff (admin can see everything, staff only their own: see staffBooking.controller)
router.get('/staff/bookings', protect, allow('staff', 'admin'), s.list);
router.get('/staff/bookings/:id', protect, allow('staff', 'admin'), s.getOne);
router.patch('/staff/bookings/:id', protect, allow('staff', 'admin'), s.update);
router.get('/staff/bookings/:id/slots', protect, allow('staff', 'admin'), s.slotsForBooking);

router.get('/staff/availability', protect, allow('staff'), a.mine);
router.put('/staff/availability', protect, allow('staff'), a.replaceMine);

module.exports = router;
