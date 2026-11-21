const mongoose = require('mongoose');

const TherapyCatalogueItemSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  category: { type: String, required: true, trim: true, maxlength: 80 },
  description: { type: String, required: true, trim: true, maxlength: 5000 },
  durationMins: { type: Number, required: true, min: 1, max: 480 },
  requiredSkills: [{ type: String, trim: true, maxlength: 120 }],
  preparationInstructions: { type: String, trim: true, maxlength: 5000 },
  postTherapyInstructions: { type: String, trim: true, maxlength: 5000 },
  contraindications: { type: String, trim: true, maxlength: 5000 },
  active: { type: Boolean, default: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

TherapyCatalogueItemSchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

module.exports = mongoose.model('TherapyCatalogueItem', TherapyCatalogueItemSchema);
