const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
	getBalance,
	fundWallet,
	withdrawToBank,
	transfer,
	payBill,
	getTransactions,
	externalBankTransfer,
	buyAirtime
} = require('../controllers/walletController');
// Buy airtime
router.post('/airtime', auth, buyAirtime);
// External bank transfer (real payment API integration)
router.post('/external-transfer', auth, externalBankTransfer);


// Wallet balance
router.get('/balance', auth, getBalance);

// Fund wallet (simulate funding from bank/agent)
router.post('/fund', auth, fundWallet);

// Withdraw to bank
router.post('/withdraw', auth, withdrawToBank);

// Transfer to another user
router.post('/transfer', auth, transfer);

// Pay bill
router.post('/pay-bill', auth, payBill);

// Get transaction history
router.get('/transactions', auth, getTransactions);

module.exports = router;
