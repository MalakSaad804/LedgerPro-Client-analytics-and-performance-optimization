const router = require('express').Router();
const c = require('../controllers/service.controller');
const { protect } = require('../middleware/auth');
const { allow } = require('../middleware/role');

router.get('/', c.list); // public
router.get('/:id/slots', protect, c.slots); // any logged-in user
router.post('/', protect, allow('staff', 'admin'), c.create);
router.patch('/:id', protect, allow('staff', 'admin'), c.update);
router.delete('/:id', protect, allow('staff', 'admin'), c.remove);

module.exports = router;
