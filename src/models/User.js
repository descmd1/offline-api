// const mongoose = require('mongoose');
// const bcrypt = require('bcryptjs');

// const userSchema = new mongoose.Schema({
//   name: { type: String, required: true },
//   email: { type: String, required: true, unique: true },
//   accountNumber: { type: String, unique: true },
//   password: { type: String, required: true },
//   pin: { type: String }, // For PIN-based auth
//   createdAt: { type: Date, default: Date.now }
// });

// userSchema.pre('save', async function (next) {
//   if (!this.isModified('password')) return next();
//   this.password = await bcrypt.hash(this.password, 10);
//   next();
// });

// userSchema.methods.comparePassword = function (candidatePassword) {
//   return bcrypt.compare(candidatePassword, this.password);
// };

// module.exports = mongoose.model('User', userSchema);



const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  accountNumber: { type: String, unique: true },
  password: { type: String, required: true },
  pin: { type: String },
  createdAt: { type: Date, default: Date.now }
});

// Hash password
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = function (candidatePassword) {
   return bcrypt.compare(candidatePassword, this.password);
 };

// Auto-generate unique account number
userSchema.pre("save", function (next) {
  if (!this.accountNumber) {
    this.accountNumber = Math.floor(1000000000 + Math.random() * 9000000000).toString();
  }
  next();
});

module.exports = mongoose.model('User', userSchema);
