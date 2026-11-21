const User = require('../models/User');
const Notification = require('../models/Notification');

const criticalTypes = new Set(['account-update']);

async function notifyUsers(userIds, type, title, body, options = {}) {
  const ids = [...new Set((userIds || []).filter(Boolean).map((user) => String(user?._id || user)))];
  if (!ids.length) return;
  try {
    const users = await User.find({ _id: { $in: ids } }).select('_id notificationPreferences').session(options.session || null).lean();
    await Promise.all(users.map(async (user) => {
      const prefs = user.notificationPreferences || {};
      if (options.reminder === 'session' && prefs.sessionReminders === false) return;
      if (options.reminder === 'follow-up' && prefs.followUpReminders === false) return;
      const channel = !criticalTypes.has(type) && prefs.inApp === false && options.reminder && prefs.email === true ? 'email' : 'in-app';
      if (!criticalTypes.has(type) && channel === 'in-app' && prefs.inApp === false) return;
      if (!criticalTypes.has(type) && prefs.categories?.[type] === false) return;
      const dedupeKey = options.dedupeKey ? `${options.dedupeKey}:${user._id}` : undefined;
      try {
        const record = { user: user._id, type, dedupeKey, session: options.sessionId, channel, payload: { title, body, type }, scheduledAt: options.scheduledAt || new Date(), status: 'pending' };
        if (!dedupeKey) await Notification.create([record], options.session ? { session: options.session } : undefined);
        else await Notification.updateOne(
          { user: user._id, dedupeKey },
          { $setOnInsert: record },
          { upsert: true, ...(options.session ? { session: options.session } : {}) }
        );
      } catch (error) { if (error.code !== 11000) throw error; }
    }));
  } catch (error) {
    // Notification failures must not make a successfully committed clinical operation appear to fail.
    console.error('In-app notification creation failed:', error.name, error.path || '');
  }
}

async function notifyAdmins(type, title, body, options) {
  const admins = await User.find({ userType: 'admin', accountStatus: { $ne: 'suspended' } }).distinct('_id');
  return notifyUsers(admins, type, title, body, options);
}

async function notifyReceptionists(type, title, body, options) {
  const receptionists = await User.find({ userType: 'receptionist', accountStatus: { $ne: 'suspended' } }).distinct('_id');
  return notifyUsers(receptionists, type, title, body, options);
}

module.exports = { notifyUsers, notifyAdmins, notifyReceptionists };
