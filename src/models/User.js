const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  accountNumber: { type: String, unique: true },
  password: { type: String, required: true },
  pin: { type: String }, // stored as bcrypt hash
  createdAt: { type: Date, default: Date.now },
});

// Single pre-save hook: auto-generate account number + hash password/pin
userSchema.pre('save', async function (next) {
  // Generate unique account number for new users
  if (this.isNew && !this.accountNumber) {
    this.accountNumber = Math.floor(1000000000 + Math.random() * 9000000000).toString();
  }

  // Hash password if modified
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 12);
  }

  // Hash PIN if provided and modified
  if (this.isModified('pin') && this.pin) {
    this.pin = await bcrypt.hash(this.pin, 12);
  }

  next();
});

userSchema.methods.comparePassword = function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.comparePin = function (candidatePin) {
  if (!this.pin) return Promise.resolve(false);
  return bcrypt.compare(candidatePin, this.pin);
};

module.exports = mongoose.model('User', userSchema);
