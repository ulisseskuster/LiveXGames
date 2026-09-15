const express = require('express');
const ShopController = require('../controllers/shopController');
const { requireAuth } = require('../middlewares/auth');

const router = express.Router();

router.get('/items', ShopController.listItems);
router.post('/purchase', requireAuth, ShopController.purchaseItem);
router.get('/inventory', requireAuth, ShopController.getInventory);
router.get('/wallet', requireAuth, ShopController.getWallet);
router.get('/wallet/:userId', requireAuth, ShopController.getWallet);

module.exports = router;
