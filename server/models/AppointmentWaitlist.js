const mongoose = require('mongoose');

const AppointmentWaitlistSchema = new mongoose.Schema({
  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  practitioner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  requestedDate: { type: Date, required: true, index: true },
  therapyType: { type: String, required: true, trim: true, maxlength: 120 },
  status: { type: String, enum: ['waiting', 'booked', 'cancelled'], default: 'waiting', index: true },
  appointment: { type: mongoose.Schema.Types.ObjectId, ref: 'TherapySession', default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  resolvedAt: Date,
}, { timestamps: true });

AppointmentWaitlistSchema.index({ patient: 1, practitioner: 1, requestedDate: 1, status: 1 }, { unique: true, partialFilterExpression: { status: 'waiting' } });

module.exports = mongoose.model('AppointmentWaitlist', AppointmentWaitlistSchema);
