const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  session: { type: mongoose.Schema.Types.ObjectId, ref: 'TherapySession' },
  type: { type: String, enum: ['appointment-booked', 'appointment-confirmed', 'appointment-rescheduled', 'appointment-cancelled', 'session-reminder', 'plan-submitted', 'plan-approved', 'plan-rejected', 'session-started', 'session-completed', 'follow-up-scheduled', 'follow-up-completed', 'feedback-received', 'patient-assigned', 'account-update', 'message-received', 'admin-update', 'other'], default: 'other', index: true },
  dedupeKey: { type: String, trim: true, maxlength: 200 },
  channel: { type: String, enum: ['email', 'sms', 'in-app', 'whatsapp'], default: 'in-app' },
  payload: { type: Object },
  scheduledAt: { type: Date, required: true },
  sentAt: { type: Date },
  emailSentAt: { type: Date },
  emailClaimedAt: { type: Date },
  twilioSid: { type: String },
  sendResponse: { type: Object },
  status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' },
  read: { type: Boolean, default: false },
  error: { type: String }
}, { timestamps: true });

NotificationSchema.index({ user: 1, dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } });
NotificationSchema.index({ user: 1, scheduledAt: -1 });

module.exports = mongoose.model('Notification', NotificationSchema);
