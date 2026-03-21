const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const User = require('../models/User');
const Wallet = require('../models/Wallet');

const signToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '7d' });

exports.register = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ message: errors.array()[0].msg });
  }

  try {
    const { name, email, password, pin } = req.body;

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ message: 'An account with that email already exists' });
    }

    const user = await User.create({ name, email, password, pin });

    // Create wallet immediately so the user can start transacting
    await Wallet.create({ user: user._id, balance: 0 });

    const token = signToken(user._id);
    return res.status(201).json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        accountNumber: user.accountNumber,
      },
    });
  } catch (err) {
    console.error('register error:', err);
    return res.status(500).json({ message: 'Registration failed. Please try again.' });
  }
};

exports.login = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ message: errors.array()[0].msg });
  }

  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      // Use the same message to prevent email enumeration
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Ensure wallet exists for older accounts
    const walletExists = await Wallet.findOne({ user: user._id });
    if (!walletExists) {
      await Wallet.create({ user: user._id, balance: 0 });
    }

    const token = signToken(user._id);
    return res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        accountNumber: user.accountNumber,
      },
    });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ message: 'Login failed. Please try again.' });
  }
};

