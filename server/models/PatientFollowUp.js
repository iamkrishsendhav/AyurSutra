const mongoose = require('mongoose');

const PatientFollowUpSchema = new mongoose.Schema({
  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  practitioner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  treatmentPlan: { type: mongoose.Schema.Types.ObjectId, ref: 'TreatmentPlan', default: null },
  session: { type: mongoose.Schema.Types.ObjectId, ref: 'TherapySession', default: null },
  dueAt: { type: Date, required: true, index: true },
  notes: { type: String, trim: true, maxlength: 3000 },
  status: { type: String, enum: ['pending', 'completed'], default: 'pending', index: true },
  completedAt: Date,
  completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

module.exports = mongoose.model('PatientFollowUp', PatientFollowUpSchema);
