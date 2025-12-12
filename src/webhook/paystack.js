// src/webhook/paystack.js
const Transaction = require('../models/Transaction');
const crypto = require('crypto');

// Replace with your Paystack secret key
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

module.exports = async (req, res) => {
  // Validate Paystack signature
  const hash = crypto.createHmac('sha512', PAYSTACK_SECRET_KEY)
    .update(req.body)
    .digest('hex');
  if (req.headers['x-paystack-signature'] !== hash) {
    return res.status(401).send('Invalid signature');
  }

  let event;
  try {
    event = JSON.parse(req.body.toString());
  } catch (e) {
    return res.status(400).send('Invalid payload');
  }

  // Handle multiple Paystack event types

  switch (event.event) {
    case 'transfer.success':
    case 'transfer.failed':
    case 'transfer.reversed':
    case 'transfer.abandoned':
    case 'transfer.dispute': {
      const transferCode = event.data.transfer_code;
      let status = 'pending';
      if (event.event === 'transfer.success') status = 'success';
      if (event.event === 'transfer.failed' || event.event === 'transfer.reversed' || event.event === 'transfer.abandoned' || event.event === 'transfer.dispute') status = 'failed';
      await Transaction.findOneAndUpdate(
        { 'details.paystack_transfer_code': transferCode },
        { status },
      );
      break;
    }
    case 'transfer.pending':
    case 'transfer.queue':
    case 'transfer.processing':
    case 'transfer.otp': {
      const transferCode = event.data.transfer_code;
      await Transaction.findOneAndUpdate(
        { 'details.paystack_transfer_code': transferCode },
        { status: 'pending' },
      );
      break;
    }
    case 'charge.success': {
      // Handle successful card/bank charge (funding)
      // Optionally, update Transaction or Wallet here
      break;
    }
    case 'charge.failed':
    case 'charge.reversed': {
      // Handle failed or reversed charge
      break;
    }
    default:
      // Log all events for audit/debug
      console.log('Paystack event:', event.event, JSON.stringify(event));
  }

  res.sendStatus(200);
};
