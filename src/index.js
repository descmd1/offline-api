require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const morgan = require('morgan');
const cors = require('cors');


const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Register webhook route after app is initialized and middleware is set up
app.post('/api/webhook/paystack', express.raw({ type: 'application/json' }), require('./webhook/paystack'));

// Auth routes
app.use('/api/auth', require('./routes/auth'));
// Wallet routes
app.use('/api/wallet', require('./routes/wallet'));

// MongoDB connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('MongoDB connected'))
.catch((err) => console.error('MongoDB connection error:', err));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
