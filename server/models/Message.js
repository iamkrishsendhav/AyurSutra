const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true, trim: true, maxlength: 5000 },
  createdAt: { type: Date, default: Date.now },
  read: { type: Boolean, default: false }
});

MessageSchema.index({ to: 1, read: 1, createdAt: -1 });
MessageSchema.index({ from: 1, to: 1, createdAt: 1 });

module.exports = mongoose.model('Message', MessageSchema);
