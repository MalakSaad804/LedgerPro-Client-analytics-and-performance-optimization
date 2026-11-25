const router = require('express').Router();
const c = require('../controllers/analytics.controller');
const { protect } = require('../middleware/auth');
const { allow } = require('../middleware/role');

// staff see their own numbers, admins see everything (decided in the controller)
router.use(protect, allow('staff', 'admin'));

router.get('/summary', c.summary);
router.get('/trends', c.trends);
router.get('/peak-times', c.peakTimes);
router.get('/staff-utilization', c.staffUtilization);

module.exports = router;
