const mongoose = require('mongoose');

const ClinicSettingsSchema = new mongoose.Schema({
  key: { type: String, default: 'clinic', unique: true, immutable: true },
  clinicName: { type: String, trim: true, maxlength: 160, default: '' },
  address: { type: String, trim: true, maxlength: 1000, default: '' },
  phone: { type: String, trim: true, maxlength: 40, default: '' },
  workingDays: [{ type: Number, min: 0, max: 6 }],
  openingTime: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/, default: '' },
  closingTime: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/, default: '' },
  defaultSessionDurationMins: { type: Number, min: 1, max: 480, default: 60 },
  minBookingNoticeMins: { type: Number, min: 0, max: 43200, default: null },
  maxAdvanceDays: { type: Number, min: 1, max: 730, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('ClinicSettings', ClinicSettingsSchema);
