const express = require('express');
const StreamerApplicationController = require('../controllers/streamerApplicationController');
const { requireAuth } = require('../middlewares/auth');

const router = express.Router();

router.post('/', requireAuth, StreamerApplicationController.submit);
router.get('/mine', requireAuth, StreamerApplicationController.getMine);

module.exports = router;
