const express = require('express');
const router = express.Router();
const { body, query } = require('express-validator');
const auth = require('../middleware/auth');
const {
  getBalance,
  fundWallet,
  withdrawToBank,
  transfer,
  getBanks,
  payBill,
  getTransactions,
  externalBankTransfer,
  buyAirtime,
} = require('../controllers/walletController');

const amountValidation = body('amount')
  .isFloat({ min: 1 })
  .withMessage('Amount must be a positive number');

// Balance
router.get('/balance', auth, getBalance);

// Nigerian banks list (for external transfer selection)
router.get('/banks', auth, getBanks);

// Fund wallet
router.post('/fund', auth, [amountValidation], fundWallet);

// Withdraw to bank
router.post('/withdraw', auth, [amountValidation], withdrawToBank);

// Transfer to another user
router.post(
  '/transfer',
  auth,
  [
    amountValidation,
    body('accountNumber').notEmpty().withMessage('Recipient account number is required'),
  ],
  transfer
);

// External bank transfer
router.post(
  '/external-transfer',
  auth,
  [
    amountValidation,
    body('accountNumber').notEmpty().withMessage('Account number is required'),
    body('bankCode').optional({ checkFalsy: true }).isString(),
    body('bankName').optional({ checkFalsy: true }).isString(),
  ],
  externalBankTransfer
);

// Buy airtime
router.post(
  '/airtime',
  auth,
  [
    amountValidation,
    body('phone').notEmpty().isMobilePhone('en-NG').withMessage('Valid Nigerian phone number required'),
    body('network')
      .isIn(['mtn', 'airtel', 'glo', '9mobile'])
      .withMessage('Network must be one of: mtn, airtel, glo, 9mobile'),
  ],
  buyAirtime
);

// Pay bill
router.post(
  '/pay-bill',
  auth,
  [amountValidation, body('biller').notEmpty().withMessage('Biller is required')],
  payBill
);

// Transaction history (with optional pagination)
router.get(
  '/transactions',
  auth,
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 50 }),
  ],
  getTransactions
);

module.exports = router;
