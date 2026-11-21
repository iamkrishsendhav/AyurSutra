const mongoose = require('mongoose');

const PlanTherapySchema = new mongoose.Schema({
  therapyType: { type: String, required: true, trim: true },
  catalogTherapy: { type: mongoose.Schema.Types.ObjectId, ref: 'TherapyCatalogueItem', default: null },
  catalogSnapshot: {
    name: String,
    category: String,
    description: String,
    durationMins: Number,
    requiredSkills: [String],
    preparationInstructions: String,
    postTherapyInstructions: String,
    contraindications: String,
  },
  sessionName: { type: String, required: true, trim: true },
  phase: { type: String, enum: ['Pre', 'Main', 'Post'], required: true },
  durationMins: { type: Number, min: 1, max: 480, required: true },
  frequencyDays: { type: Number, min: 1, max: 365, required: true },
  occurrences: { type: Number, min: 1, max: 100, required: true },
  startTime: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/, default: '10:00' },
  instructions: { type: String, trim: true, maxlength: 3000 },
});

const TreatmentPlanSchema = new mongoose.Schema({
  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  assessment: { type: mongoose.Schema.Types.ObjectId, ref: 'DoctorAssessment', required: true },
  doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, trim: true, maxlength: 160, default: '' },
  objectives: { type: String, trim: true, maxlength: 3000, default: '' },
  precautions: { type: String, trim: true, maxlength: 3000, default: '' },
  startDate: { type: Date, required: true },
  therapies: { type: [PlanTherapySchema], validate: [(items) => items.length > 0, 'At least one therapy is required'] },
  status: { type: String, enum: ['draft', 'pending-approval', 'approved', 'rejected'], default: 'draft', index: true },
  approval: { status: { type: String, enum: ['approved', 'rejected'] }, reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, reviewedAt: Date, note: { type: String, maxlength: 2000 } },
  reviewHistory: [{ status: { type: String, enum: ['approved', 'rejected'], required: true }, reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, reviewedAt: { type: Date, default: Date.now }, note: { type: String, maxlength: 2000 } }],
  revisions: [{ revision: Number, therapies: [PlanTherapySchema], changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, changedAt: { type: Date, default: Date.now }, reason: String }],
  generatedAt: Date,
}, { timestamps: true });

module.exports = mongoose.model('TreatmentPlan', TreatmentPlanSchema);
