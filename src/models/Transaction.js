const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      enum: ['fund', 'withdraw', 'transfer', 'bill', 'external-transfer', 'airtime'],
      required: true,
    },
    amount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ['pending', 'success', 'failed'], default: 'pending' },
    reference: { type: String, index: true },
    details: { type: Object },
  },
  { timestamps: true }
);

// Compound index for fast user transaction history queries
transactionSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Transaction', transactionSchema);
