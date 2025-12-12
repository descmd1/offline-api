const axios = require('axios');
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
// External bank transfer (Paystack integration)
exports.externalBankTransfer = async (req, res) => {
  try {
    const { accountNumber, bankCode, amount, reference, details } = req.body;
    if (amount <= 0) return res.status(400).json({ message: 'Invalid amount' });
    const wallet = await Wallet.findOne({ user: req.user.id });
    if (!wallet || wallet.balance < amount) return res.status(400).json({ message: 'Insufficient balance' });

    // Step 1: Initiate transfer recipient on Paystack
    const recipientResp = await axios.post(
      'https://api.paystack.co/transferrecipient',
      {
        type: 'nuban',
        name: req.user.name || 'Recipient',
        account_number: accountNumber,
        bank_code: bankCode,
        currency: 'NGN',
      },
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );
    if (!recipientResp.data.status) {
      return res.status(500).json({ message: 'Failed to create transfer recipient', error: recipientResp.data.message });
    }
    const recipientCode = recipientResp.data.data.recipient_code;

    // Step 2: Initiate transfer
    const transferResp = await axios.post(
      'https://api.paystack.co/transfer',
      {
        source: 'balance',
        amount: Math.round(amount * 100), // Paystack expects kobo
        recipient: recipientCode,
        reason: reference || 'External transfer',
      },
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );
    if (!transferResp.data.status) {
      console.error('Paystack transfer failed:', transferResp.data);
      return res.status(500).json({ message: 'Bank transfer failed', error: transferResp.data.message });
    }

    try {
      wallet.balance -= amount;
      wallet.updatedAt = Date.now();
      await wallet.save();

      console.log('Creating external-transfer transaction:', {
        user: req.user.id,
        type: 'external-transfer',
        amount,
        status: 'pending',
        reference,
        details: { ...details, to: accountNumber, bankCode, paystack_transfer_code: transferResp.data.data.transfer_code },
      });
      const txn = await Transaction.create({
        user: req.user.id,
        type: 'external-transfer',
        amount,
        status: 'pending', // Paystack transfer may be pending
        reference,
        details: { ...details, to: accountNumber, bankCode, paystack_transfer_code: transferResp.data.data.transfer_code },
      });
      console.log('Transaction created:', txn._id);

      res.json({ balance: wallet.balance, message: 'Transfer initiated', paystack: transferResp.data.data, transactionId: txn._id });
    } catch (err2) {
      console.error('Transaction creation failed:', err2);
      return res.status(500).json({ message: 'Transaction creation failed', error: err2.message });
    }
  } catch (err) {
    let errorMsg = err.response?.data?.message || err.message;
    res.status(500).json({ message: 'Server error', error: errorMsg });
  }
};


const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const User = require('../models/User');

// Buy airtime (simulate purchase, with network validation)
exports.buyAirtime = async (req, res) => {
  try {
    const { amount, phone, network, reference, details } = req.body;
    if (amount <= 0) return res.status(400).json({ message: 'Invalid amount' });
    if (!phone) return res.status(400).json({ message: 'Phone number required' });
    if (!network) return res.status(400).json({ message: 'Network required' });

    // Simple phone number validation by network prefix
    const networkPrefixes = {
      mtn: ['0803', '0806', '0703', '0706', '0813', '0816', '0810', '0814', '0903', '0906', '0913', '0916'],
      glo: ['0805', '0807', '0705', '0815', '0811', '0905'],
      airtel: ['0802', '0808', '0708', '0812', '0701', '0902', '0907', '0901', '0912'],
      '9mobile': ['0809', '0817', '0818', '0909', '0908'],
    };
    const prefix = phone.slice(0, 4);
    if (!networkPrefixes[network] || !networkPrefixes[network].includes(prefix)) {
      return res.status(400).json({ message: `Phone number does not match selected network (${network.toUpperCase()})` });
    }

    const wallet = await Wallet.findOne({ user: req.user.id });
    if (!wallet || wallet.balance < amount) return res.status(400).json({ message: 'Insufficient balance' });
    wallet.balance -= amount;
    wallet.updatedAt = Date.now();
    await wallet.save();
    // Log transaction
    await Transaction.create({
      user: req.user.id,
      type: 'airtime',
      amount,
      status: 'success',
      reference,
      details: { ...details, phone, network },
    });
    res.json({ balance: wallet.balance });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};


exports.getBalance = async (req, res) => {
  try {
    const wallet = await Wallet.findOne({ user: req.user.id });
    if (!wallet) return res.status(404).json({ balance: 0 });
    res.json({ balance: wallet.balance });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// Fund wallet (simulate funding from bank/agent)
exports.fundWallet = async (req, res) => {
  try {
    const { amount, reference, details } = req.body;
    if (amount <= 0) return res.status(400).json({ message: 'Invalid amount' });
    let wallet = await Wallet.findOne({ user: req.user.id });
    if (!wallet) {
      wallet = await Wallet.create({ user: req.user.id, balance: amount });
    } else {
      wallet.balance += amount;
      wallet.updatedAt = Date.now();
      await wallet.save();
    }
    // Log transaction
    await Transaction.create({
      user: req.user.id,
      type: 'fund',
      amount,
      status: 'success',
      reference,
      details,
    });
    res.json({ balance: wallet.balance });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// Withdraw to bank (simulate withdrawal)
exports.withdrawToBank = async (req, res) => {
  try {
    const { amount, reference, details } = req.body;
    if (amount <= 0) return res.status(400).json({ message: 'Invalid amount' });
    const wallet = await Wallet.findOne({ user: req.user.id });
    if (!wallet || wallet.balance < amount) return res.status(400).json({ message: 'Insufficient balance' });
    wallet.balance -= amount;
    wallet.updatedAt = Date.now();
    await wallet.save();
    // Log transaction
    await Transaction.create({
      user: req.user.id,
      type: 'withdraw',
      amount,
      status: 'success',
      reference,
      details,
    });
    res.json({ balance: wallet.balance });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// Transfer to another user (by account number)
exports.transfer = async (req, res) => {
  try {
    const { amount, accountNumber, reference, details } = req.body;
    if (amount <= 0) return res.status(400).json({ message: 'Invalid amount' });
    if (!accountNumber) return res.status(400).json({ message: 'Recipient account number required' });
    const senderWallet = await Wallet.findOne({ user: req.user.id });
    if (!senderWallet || senderWallet.balance < amount) return res.status(400).json({ message: 'Insufficient balance' });
    const recipientUser = await User.findOne({ accountNumber });
    if (!recipientUser) return res.status(404).json({ message: 'Recipient not found' });
    let recipientWallet = await Wallet.findOne({ user: recipientUser._id });
    if (!recipientWallet) {
      recipientWallet = await Wallet.create({ user: recipientUser._id, balance: amount });
    } else {
      recipientWallet.balance += amount;
      recipientWallet.updatedAt = Date.now();
      await recipientWallet.save();
    }
    senderWallet.balance -= amount;
    senderWallet.updatedAt = Date.now();
    await senderWallet.save();
    // Log transaction for sender
    await Transaction.create({
      user: req.user.id,
      type: 'transfer',
      amount,
      status: 'success',
      reference,
      details: { ...details, to: accountNumber },
    });
    // Log transaction for recipient
    await Transaction.create({
      user: recipientUser._id,
      type: 'transfer',
      amount,
      status: 'success',
      reference,
      details: { ...details, from: req.user.accountNumber },
    });
    res.json({ balance: senderWallet.balance });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// Pay bill (simulate bill payment)
exports.payBill = async (req, res) => {
  try {
    const { amount, biller, reference, details } = req.body;
    if (amount <= 0) return res.status(400).json({ message: 'Invalid amount' });
    if (!biller) return res.status(400).json({ message: 'Biller required' });
    const wallet = await Wallet.findOne({ user: req.user.id });
    if (!wallet || wallet.balance < amount) return res.status(400).json({ message: 'Insufficient balance' });
    wallet.balance -= amount;
    wallet.updatedAt = Date.now();
    await wallet.save();
    // Log transaction
    await Transaction.create({
      user: req.user.id,
      type: 'bill',
      amount,
      status: 'success',
      reference,
      details: { ...details, biller },
    });
    res.json({ balance: wallet.balance });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// Get transaction history
exports.getTransactions = async (req, res) => {
  try {
    const txns = await Transaction.find({ user: req.user.id }).sort({ createdAt: -1 });
    res.json({ transactions: txns });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

exports.deposit = async (req, res) => {
  try {
    const { amount } = req.body;
    if (amount <= 0) return res.status(400).json({ message: 'Invalid amount' });
    let wallet = await Wallet.findOne({ user: req.user.id });
    if (!wallet) {
      wallet = await Wallet.create({ user: req.user.id, balance: amount });
    } else {
      wallet.balance += amount;
      wallet.updatedAt = Date.now();
      await wallet.save();
    }
    res.json({ balance: wallet.balance });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

exports.withdraw = async (req, res) => {
  try {
    const { amount } = req.body;
    if (amount <= 0) return res.status(400).json({ message: 'Invalid amount' });
    const wallet = await Wallet.findOne({ user: req.user.id });
    if (!wallet || wallet.balance < amount) return res.status(400).json({ message: 'Insufficient balance' });
    wallet.balance -= amount;
    wallet.updatedAt = Date.now();
    await wallet.save();
    res.json({ balance: wallet.balance });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
