const ScheduleLock = require('../models/ScheduleLock');

async function acquireScheduleLocks(session, { date, patientId, practitionerId }) {
  const day = new Date(date).toISOString().slice(0, 10);
  const keys = [`patient:${patientId}:${day}`];
  if (practitionerId) keys.push(`practitioner:${practitionerId}:${day}`);
  keys.sort();
  for (const lockKey of keys) {
    await ScheduleLock.findOneAndUpdate(
      { lockKey },
      { $inc: { version: 1 }, $set: { updatedAt: new Date() }, $setOnInsert: { lockKey } },
      { upsert: true, new: true, session, setDefaultsOnInsert: true }
    );
  }
}

module.exports = { acquireScheduleLocks };
