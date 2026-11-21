const mongoose = require('mongoose');

const DoctorAssessmentSchema = new mongoose.Schema({
  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  assessedAt: { type: Date, required: true, default: Date.now },
  symptoms: [{ type: String, trim: true, maxlength: 500 }],
  observations: { type: String, trim: true, maxlength: 5000 },
  diagnosis: { type: String, trim: true, maxlength: 2000 },
  recommendations: { type: String, trim: true, maxlength: 5000 },
  clinicalNotes: { type: String, trim: true, maxlength: 10000 },
}, { timestamps: true });

module.exports = mongoose.model('DoctorAssessment', DoctorAssessmentSchema);
