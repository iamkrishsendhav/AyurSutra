const mongoose = require('mongoose');

const ScheduleLockSchema = new mongoose.Schema({
  lockKey: { type: String, required: true, unique: true },
  version: { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now },
});

ScheduleLockSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 172800 });

module.exports = mongoose.model('ScheduleLock', ScheduleLockSchema);
