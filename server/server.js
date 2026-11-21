// Load environment variables from .env when present (development)
require('dotenv').config();
const express = require("express");
const mongoose = require('mongoose');
const MongoStore = require('connect-mongo').default;
const connectDB = require("./config/db");
const cors = require("cors");
const passport = require('./config/passport');
const session = require('express-session');

const app = express();

const mongoClientPromise = new Promise((resolve, reject) => {
  const connection = mongoose.connection;
  if (connection.readyState === 1) return resolve(connection.getClient());
  const onConnected = () => {
    connection.off('error', onError);
    resolve(connection.getClient());
  };
  const onError = (error) => {
    connection.off('connected', onConnected);
    reject(error);
  };
  connection.once('connected', onConnected);
  connection.once('error', onError);
});

if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

// ---------------- Middleware ----------------
app.use(express.json());
// Configure deployed frontend origins with a comma-separated CORS_ORIGINS value.
const allowedOrigins = (process.env.CORS_ORIGINS || [
  'http://localhost:3000',
  'http://localhost:3001'
].join(','))
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like curl, mobile apps, or server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin.replace(/\/$/, ''))) {
      return callback(null, true);
    }
    return callback(new Error('CORS policy: This origin is not allowed'), false);
  },
  credentials: true,
}));

// Session configuration for Passport
app.use(session({
  secret: process.env.SESSION_SECRET || (process.env.NODE_ENV === 'production' ? undefined : 'ayursutra-local-session-secret'),
  store: MongoStore.create({ clientPromise: mongoClientPromise, collectionName: 'sessions', autoRemove: 'native' }),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// ---------------- Routes ----------------
app.get('/health', (req, res) => {
  const mongoose = require('mongoose');
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'unavailable', database: ready ? 'connected' : 'disconnected' });
});
app.use("/api/auth", require("./routes/auth"));
// Legacy auth routes for Google OAuth callback compatibility
app.use("/auth", require("./routes/auth"));
app.use("/therapy", require("./routes/therapy"));
app.use("/sessions", require("./routes/sessions"));
app.use("/api/dashboard", require("./routes/dashboard")); // ✅ Patient & Practitioner dashboards
app.use("/api/chat", require("./routes/chatRoutes")); // ✅ AI Chatbot route
app.use("/api/practitioner", require("./routes/practitioner")); // ✅ Practitioner patient management
app.use("/api/treatment-plans", require("./routes/treatmentPlans"));
app.use("/api/practitioner-search", require("./routes/practitionerSearch")); // ✅ Practitioner search and assignment
app.use("/api/profile", require("./routes/profile")); // ✅ Profile management
app.use('/api/admin/patients', require('./routes/adminPatients'));
app.use('/api/therapies', require('./routes/therapies'));
app.use('/api/admin/practitioners', require('./routes/adminPractitioners'));
app.use('/api/admin/staff', require('./routes/adminStaff'));
app.use('/api/receptionist', require('./routes/receptionistOperations'));
app.use('/api/admin/operations', require('./routes/adminOperations'));
app.use('/api/admin/reports', require('./routes/adminReports'));
app.use('/api/follow-ups', require('./routes/followUps'));
app.use("/api/verification", require("./routes/verification")); // ✅ Practitioner verification
app.use("/api/progress", require("./routes/progress")); // ✅ Progress tracking
// New messaging and notification routes
app.use('/api/messages', require('./routes/messages'));
app.use('/api/notifications', require('./routes/notifications'));
// Admin / debug endpoints (test WhatsApp send, list recent notifications)
app.use('/admin', require('./routes/adminNotifications'));

// Auth debug endpoints expose user records and request headers, so they are
// intentionally not mounted in the application.

// Start only after MongoDB is ready so routes and background jobs cannot query
// against a disconnected Mongoose instance.
const start = async () => {
  try {
    if (process.env.NODE_ENV === 'production') {
      const missing = [];
      if (!process.env.MONGODB_URI) missing.push('MONGODB_URI');
      if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) missing.push('JWT_SECRET (minimum 32 characters)');
      if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) missing.push('SESSION_SECRET (minimum 32 characters)');
      if (!process.env.CLIENT_URL) missing.push('CLIENT_URL');
      if (!process.env.CORS_ORIGINS) missing.push('CORS_ORIGINS');
      if (missing.length) throw new Error(`Missing production environment configuration: ${missing.join(', ')}`);
      const mongoUri = new URL(process.env.MONGODB_URI);
      if (!mongoUri.pathname || mongoUri.pathname === '/') throw new Error('MONGODB_URI must include an explicit production database name');
      const clientOrigin = new URL(process.env.CLIENT_URL).origin;
      if (!allowedOrigins.includes(clientOrigin)) throw new Error('CORS_ORIGINS must include the CLIENT_URL origin');
    }
    await connectDB();
    const { startNotificationWorker } = require('./workers/notificationWorker');
    await startNotificationWorker();
    const PORT = process.env.PORT || 5000;
    const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
    return server;
  } catch (err) {
    process.exitCode = 1;
    return null;
  }
};

if (require.main === module) start();
module.exports = { app, start };


