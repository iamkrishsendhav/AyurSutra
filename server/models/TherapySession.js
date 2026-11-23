const mongoose = require("mongoose");

const TherapySessionSchema = new mongoose.Schema({
  patient: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  // Practitioner may be assigned later; make optional to allow partial documents
  practitioner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  treatmentPlan: { type: mongoose.Schema.Types.ObjectId, ref: 'TreatmentPlan', default: null, index: true },
  catalogTherapy: { type: mongoose.Schema.Types.ObjectId, ref: 'TherapyCatalogueItem', default: null },
  therapySnapshot: {
    name: String,
    category: String,
    description: String,
    durationMins: Number,
    requiredSkills: [String],
    preparationInstructions: String,
    postTherapyInstructions: String,
    contraindications: String,
  },
  planSessionKey: { type: String, default: undefined },
  therapyType: { type: String, required: true },
  phase: { type: String, required: true },
  sessionName: { type: String, required: true },
  date: { 
    type: Date, 
    required: true,
    validate: {
      validator: function(v) {
        // Skip date validation for cancelled sessions
        if (this.status === 'cancelled') {
          return true;
        }
        return v >= new Date(new Date().setHours(0, 0, 0, 0));
      },
      message: 'Session date cannot be in the past'
    }
  },
  startTime: { 
    type: String, 
    default: "10:00",
    validate: {
      validator: function(v) {
        return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(v);
      },
      message: 'Invalid time format. Use HH:MM format'
    }
  },
  durationMins: { type: Number, min: 1, default: 60 },
  isBooked: { type: Boolean, default: false },
  checkedInAt: { type: Date },
  checkedInBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  queueCalledAt: { type: Date },
  queueCalledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status: { 
    type: String, 
    enum: {
      values: ['scheduled', 'confirmed', 'in-progress', 'completed', 'cancelled'],
      message: props => `'${props.value}' is not a valid session status`
    },
    default: 'scheduled',
    set: function(v) {
      if (typeof v !== 'string') {
        throw new Error('Status must be a string');
      }
      // Force lowercase and trim any whitespace
      const normalized = v.toLowerCase().trim();
      if (!['scheduled', 'confirmed', 'in-progress', 'completed', 'cancelled'].includes(normalized)) {
        throw new Error(`'${v}' is not a valid session status`);
      }
      return normalized;
    },
    get: function(v) {
      // Always return lowercase
      return v ? v.toLowerCase() : 'scheduled';
    }
  },
  statusHistory: [{
    status: { type: String, enum: ['scheduled', 'confirmed', 'in-progress', 'completed', 'cancelled'] },
    changedAt: { type: Date, default: Date.now },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reason: { type: String, maxlength: 1000 },
  }],
  scheduleHistory: [{
    from: { date: Date, startTime: String },
    to: { date: Date, startTime: String },
    changedAt: { type: Date, default: Date.now },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reason: { type: String, maxlength: 1000 },
  }],
  notes: { type: String },
  practitionerNotes: {
    progress: { type: String },
    sessionNotes: { type: String },
    followUp: { type: String }
  },
  clinicalRecord: {
    actualStartedAt: Date,
    actualCompletedAt: Date,
    actualDurationMins: { type: Number, min: 0, max: 1440 },
    observations: { type: String, maxlength: 5000 },
    treatmentNotes: { type: String, maxlength: 5000 },
    completionRemarks: { type: String, maxlength: 3000 },
    followUpRecommendations: { type: String, maxlength: 3000 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedAt: Date,
  },
  feedback: {
    wellness: { type: Number, min: 0, max: 10 },
    energy: { type: Number, min: 0, max: 10 },
    sleep: { type: Number, min: 0, max: 10 },
    symptoms: [String],
    comments: { type: String, maxlength: 2000 },
    submittedAt: Date,
  },
  recommendations: { type: String },
  precautions: [String],
  metrics: {
    bloodPressure: String,
    pulse: Number,
    weight: Number,
    temperature: Number
  },
  cancelledReason: { type: String }
}, {
  timestamps: true
});

TherapySessionSchema.index({ treatmentPlan: 1, planSessionKey: 1 }, { unique: true, partialFilterExpression: { planSessionKey: { $type: 'string' } } });

module.exports = mongoose.model("TherapySession", TherapySessionSchema);



