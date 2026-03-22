// All imports at the top — avoids temporal dead zone confusion
const axios = require('axios');
const { validationResult } = require('express-validator');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const User = require('../models/User');

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const BANK_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let banksCache = { data: null, fetchedAt: 0 };

// Helper to extract error message
const extractError = (err) =>
  err.response?.data?.message || err.message || 'Unknown error';

const getBanksFromProvider = async () => {
  const cacheFresh =
    banksCache.data && Date.now() - banksCache.fetchedAt < BANK_CACHE_TTL_MS;

  if (cacheFresh) return banksCache.data;

  const response = await axios.get(
    'https://api.paystack.co/bank?country=nigeria&currency=NGN&perPage=100',
    {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
    }
  );

  if (!response.data?.status) {
    throw new Error('Unable to fetch bank list');
  }

  const banks = (response.data.data || [])
    .filter((bank) => bank?.active !== false && bank?.code && bank?.name)
    .map((bank) => ({ name: bank.name, code: bank.code }))
    .sort((a, b) => a.name.localeCompare(b.name));

  banksCache = { data: banks, fetchedAt: Date.now() };
  return banks;
};

// ─── Balance ────────────────────────────────────────────────────────────────
exports.getBalance = async (req, res) => {
  try {
    const wallet = await Wallet.findOne({ user: req.user.id });
    if (!wallet) return res.status(404).json({ message: 'Wallet not found', balance: 0 });
    return res.json({ balance: wallet.balance });
  } catch (err) {
    console.error('getBalance error:', err);
    return res.status(500).json({ message: 'Unable to fetch balance' });
  }
};

// ─── Nigerian Banks ─────────────────────────────────────────────────────────
exports.getBanks = async (_req, res) => {
  try {
    if (!PAYSTACK_SECRET_KEY) {
      return res.status(500).json({ message: 'Bank list provider is not configured' });
    }

    const banks = await getBanksFromProvider();
    return res.json({ banks });
  } catch (err) {
    console.error('getBanks error:', err);
    return res.status(502).json({ message: 'Unable to fetch bank list', error: extractError(err) });
  }
};

// ─── Fund Wallet ─────────────────────────────────────────────────────────────
exports.fundWallet = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ message: errors.array()[0].msg });

  try {
    const { amount, reference, details } = req.body;
    let wallet = await Wallet.findOne({ user: req.user.id });
    if (!wallet) {
      wallet = await Wallet.create({ user: req.user.id, balance: amount });
    } else {
      wallet.balance += amount;
      await wallet.save();
    }
    await Transaction.create({
      user: req.user.id,
      type: 'fund',
      amount,
      status: 'success',
      reference,
      details,
    });
    return res.json({ balance: wallet.balance });
  } catch (err) {
    console.error('fundWallet error:', err);
    return res.status(500).json({ message: 'Funding failed' });
  }
};

// ─── Withdraw to Bank ────────────────────────────────────────────────────────
exports.withdrawToBank = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ message: errors.array()[0].msg });

  try {
    const { amount, reference, details } = req.body;
    const wallet = await Wallet.findOne({ user: req.user.id });
    if (!wallet || wallet.balance < amount) {
      return res.status(400).json({ message: 'Insufficient balance' });
    }
    wallet.balance -= amount;
    await wallet.save();
    await Transaction.create({
      user: req.user.id,
      type: 'withdraw',
      amount,
      status: 'success',
      reference,
      details,
    });
    return res.json({ balance: wallet.balance });
  } catch (err) {
    console.error('withdrawToBank error:', err);
    return res.status(500).json({ message: 'Withdrawal failed' });
  }
};

// ─── Transfer (Internal — between platform users) ────────────────────────────
exports.transfer = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ message: errors.array()[0].msg });

  try {
    const { amount, accountNumber, reference, details } = req.body;

    const senderWallet = await Wallet.findOne({ user: req.user.id });
    if (!senderWallet || senderWallet.balance < amount) {
      return res.status(400).json({ message: 'Insufficient balance' });
    }

    const recipientUser = await User.findOne({ accountNumber });
    if (!recipientUser) {
      return res.status(404).json({ message: 'Recipient account not found' });
    }
    if (recipientUser._id.toString() === req.user.id) {
      return res.status(400).json({ message: 'Cannot transfer to yourself' });
    }

    let recipientWallet = await Wallet.findOne({ user: recipientUser._id });
    if (!recipientWallet) {
      recipientWallet = await Wallet.create({ user: recipientUser._id, balance: 0 });
    }

    // Update both wallets
    senderWallet.balance -= amount;
    recipientWallet.balance += amount;
    await senderWallet.save();
    await recipientWallet.save();

    // Log both sides of the transaction
    await Transaction.create([
      {
        user: req.user.id,
        type: 'transfer',
        amount,
        status: 'success',
        reference,
        details: { ...details, to: accountNumber, toName: recipientUser.name },
      },
      {
        user: recipientUser._id,
        type: 'transfer',
        amount,
        status: 'success',
        reference,
        details: { ...details, from: senderWallet.user?.toString(), direction: 'credit' },
      },
    ]);

    return res.json({ balance: senderWallet.balance });
  } catch (err) {
    console.error('transfer error:', err);
    return res.status(500).json({ message: 'Transfer failed' });
  }
};

// ─── External Bank Transfer (Paystack) ──────────────────────────────────────
exports.externalBankTransfer = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ message: errors.array()[0].msg });

  try {
    const { accountNumber, bankCode, bankName, amount, reference, details } = req.body;

    if (!bankCode && !bankName) {
      return res.status(422).json({ message: 'Bank name or bank code is required' });
    }

    let resolvedBankCode = bankCode;
    if (!resolvedBankCode && bankName) {
      if (!PAYSTACK_SECRET_KEY) {
        return res.status(500).json({ message: 'Bank list provider is not configured' });
      }
      const banks = await getBanksFromProvider();
      const matched = banks.find(
        (bank) => bank.name.toLowerCase() === String(bankName).toLowerCase()
      );
      if (!matched) {
        return res.status(422).json({ message: 'Selected bank is invalid' });
      }
      resolvedBankCode = matched.code;
    }

    const wallet = await Wallet.findOne({ user: req.user.id });
    if (!wallet || wallet.balance < amount) {
      return res.status(400).json({ message: 'Insufficient balance' });
    }

    // Fetch full user to get name
    const user = await User.findById(req.user.id).select('name');

    // Step 1: Create transfer recipient
    let recipientCode;
    try {
      const recipientResp = await axios.post(
        'https://api.paystack.co/transferrecipient',
        {
          type: 'nuban',
          name: user?.name || 'Recipient',
          account_number: accountNumber,
          bank_code: resolvedBankCode,
          currency: 'NGN',
        },
        {
          headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
        }
      );
      if (!recipientResp.data.status) {
        return res.status(502).json({ message: 'Failed to create transfer recipient' });
      }
      recipientCode = recipientResp.data.data.recipient_code;
    } catch (err) {
      return res.status(502).json({ message: 'Payment gateway error', error: extractError(err) });
    }

    // Step 2: Deduct balance BEFORE initiating transfer (reserve funds)
    wallet.balance -= amount;
    await wallet.save();

    // Step 3: Initiate transfer
    let transferData;
    try {
      const transferResp = await axios.post(
        'https://api.paystack.co/transfer',
        {
          source: 'balance',
          amount: Math.round(amount * 100), // kobo
          recipient: recipientCode,
          reason: reference || 'External transfer',
        },
        {
          headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
        }
      );
      if (!transferResp.data.status) {
        // Rollback balance
        wallet.balance += amount;
        await wallet.save();
        return res.status(502).json({ message: 'Bank transfer initiation failed' });
      }
      transferData = transferResp.data.data;
    } catch (err) {
      // Rollback balance on Paystack API error
      wallet.balance += amount;
      await wallet.save();
      return res.status(502).json({ message: 'Payment gateway error', error: extractError(err) });
    }

    const txn = await Transaction.create({
      user: req.user.id,
      type: 'external-transfer',
      amount,
      status: 'pending',
      reference,
      details: {
        ...details,
        to: accountNumber,
        bankCode: resolvedBankCode,
        bankName,
        paystack_transfer_code: transferData.transfer_code,
      },
    });

    return res.json({
      balance: wallet.balance,
      message: 'Transfer initiated successfully',
      transactionId: txn._id,
    });
  } catch (err) {
    console.error('externalBankTransfer error:', err);
    return res.status(500).json({ message: 'Transfer failed' });
  }
};

// ─── Buy Airtime ─────────────────────────────────────────────────────────────
exports.buyAirtime = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ message: errors.array()[0].msg });

  try {
    const { amount, phone, network, reference, details } = req.body;

    const networkPrefixes = {
      mtn: ['0803', '0806', '0703', '0706', '0813', '0816', '0810', '0814', '0903', '0906', '0913', '0916'],
      glo: ['0805', '0807', '0705', '0815', '0811', '0905'],
      airtel: ['0802', '0808', '0708', '0812', '0701', '0902', '0907', '0901', '0912'],
      '9mobile': ['0809', '0817', '0818', '0909', '0908'],
    };

    const prefix = phone.slice(0, 4);
    if (!networkPrefixes[network] || !networkPrefixes[network].includes(prefix)) {
      return res.status(400).json({
        message: `Phone number does not match ${network.toUpperCase()}. Please check the number and network.`,
      });
    }

    const wallet = await Wallet.findOne({ user: req.user.id });
    if (!wallet || wallet.balance < amount) {
      return res.status(400).json({ message: 'Insufficient balance' });
    }
    wallet.balance -= amount;
    await wallet.save();

    await Transaction.create({
      user: req.user.id,
      type: 'airtime',
      amount,
      status: 'success',
      reference,
      details: { ...details, phone, network },
    });

    return res.json({ balance: wallet.balance });
  } catch (err) {
    console.error('buyAirtime error:', err);
    return res.status(500).json({ message: 'Airtime purchase failed' });
  }
};

// ─── Pay Bill ────────────────────────────────────────────────────────────────
exports.payBill = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ message: errors.array()[0].msg });

  try {
    const { amount, biller, reference, details } = req.body;
    const wallet = await Wallet.findOne({ user: req.user.id });
    if (!wallet || wallet.balance < amount) {
      return res.status(400).json({ message: 'Insufficient balance' });
    }
    wallet.balance -= amount;
    await wallet.save();

    await Transaction.create({
      user: req.user.id,
      type: 'bill',
      amount,
      status: 'success',
      reference,
      details: { ...details, biller },
    });

    return res.json({ balance: wallet.balance });
  } catch (err) {
    console.error('payBill error:', err);
    return res.status(500).json({ message: 'Bill payment failed' });
  }
};

// ─── Transaction History ─────────────────────────────────────────────────────
exports.getTransactions = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      Transaction.find({ user: req.user.id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Transaction.countDocuments({ user: req.user.id }),
    ]);

    return res.json({
      transactions,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('getTransactions error:', err);
    return res.status(500).json({ message: 'Unable to fetch transactions' });
  }
};
