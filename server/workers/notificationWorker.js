const cron = require('node-cron');
const Notification = require('../models/Notification');
const TherapySession = require('../models/TherapySession');
const PatientFollowUp = require('../models/PatientFollowUp');
const nodemailer = require('nodemailer');
const { notifyUsers, notifyAdmins } = require('../utils/notifications');

const SMTP_HOST = process.env.SMTP_HOST; const SMTP_USER = process.env.SMTP_USER; const SMTP_PASS = process.env.SMTP_PASS;
const EMAIL_FROM = process.env.EMAIL_FROM;
const transporter = SMTP_HOST && SMTP_USER && SMTP_PASS ? nodemailer.createTransport({ host: SMTP_HOST, auth: { user: SMTP_USER, pass: SMTP_PASS } }) : null;
const clinicTimezone = process.env.CLINIC_TIMEZONE || process.env.TZ || 'Asia/Kolkata';

function datePartsInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
}

function clinicLocalDateTime(dateValue, timeValue, timeZone = clinicTimezone) {
  const dateText = dateValue instanceof Date ? dateValue.toISOString().slice(0, 10) : String(dateValue).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText) || !/^\d{2}:\d{2}$/.test(String(timeValue))) return null;
  const [year, month, day] = dateText.split('-').map(Number); const [hour, minute] = timeValue.split(':').map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = target;
  for (let index = 0; index < 2; index++) {
    const parts = datePartsInZone(new Date(candidate), timeZone);
    const observed = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    candidate += target - observed;
  }
  return new Date(candidate);
}

async function deliverOptInEmail(user, notification) {
  if (!transporter || user.notificationPreferences?.email !== true || !user.email) return;
  const claimAfter = new Date(Date.now() - 15 * 60 * 1000);
  const claimed = await Notification.findOneAndUpdate(
    { _id: notification._id, emailSentAt: { $exists: false }, $or: [{ emailClaimedAt: { $exists: false } }, { emailClaimedAt: { $lt: claimAfter } }] },
    { $set: { emailClaimedAt: new Date() } }, { new: true }
  );
  if (!claimed) return;
  try {
    await transporter.sendMail({ from: EMAIL_FROM || SMTP_USER, to: user.email, subject: notification.payload?.title || 'AyurSutra reminder', text: notification.payload?.body || 'You have an AyurSutra update.' });
    await Notification.updateOne({ _id: notification._id }, { $set: { emailSentAt: new Date(), sentAt: new Date(), status: 'sent', channel: 'email' }, $unset: { emailClaimedAt: 1 } });
  } catch (error) {
    await Notification.updateOne({ _id: notification._id }, { $set: { status: 'failed', error: 'Email delivery failed' }, $unset: { emailClaimedAt: 1 } });
    console.error('Reminder email delivery failed:', error.name);
  }
}

async function runNotificationSweep(now = new Date()) {
  const lookaheadMinutes = Math.min(1440, Math.max(1, Number.parseInt(process.env.NOTIFY_LOOKAHEAD_MINUTES || '60', 10) || 60));
  const upper = new Date(now.getTime() + lookaheadMinutes * 60000);
  const queryFrom = new Date(now.getTime() - 48 * 60 * 60 * 1000); const queryTo = new Date(upper.getTime() + 48 * 60 * 60 * 1000);
  const sessions = await TherapySession.find({ date: { $gte: queryFrom, $lte: queryTo }, status: { $in: ['scheduled', 'confirmed'] } }).populate('patient', 'name email notificationPreferences').populate('practitioner', 'name email notificationPreferences').lean();
  for (const session of sessions) {
    const scheduledAt = clinicLocalDateTime(session.date, session.startTime);
    if (!scheduledAt || scheduledAt < now || scheduledAt > upper) continue;
    const title = 'Upcoming therapy session'; const day = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: clinicTimezone }).format(scheduledAt);
    const body = `${session.therapySnapshot?.name || session.therapyType || 'Therapy'} is scheduled for ${day} at ${session.startTime}.`;
    const dateKey = session.date instanceof Date ? session.date.toISOString().slice(0, 10) : String(session.date).slice(0, 10);
    const dedupeKey = `session-reminder:${session._id}:${dateKey}:${session.startTime}`;
    const recipients = [session.patient, session.practitioner].filter((user) => user && user.notificationPreferences?.sessionReminders !== false);
    await notifyUsers(recipients.map((user) => user._id), 'session-reminder', title, body, { dedupeKey, scheduledAt, reminder: 'session', sessionId: session._id });
    const notes = await Notification.find({ dedupeKey: { $in: recipients.map((user) => `${dedupeKey}:${user._id}`) } });
    for (const note of notes) {
      const recipient = recipients.find((user) => String(user._id) === String(note.user));
      if (recipient) await deliverOptInEmail(recipient, note);
    }
  }

  const followUps = await PatientFollowUp.find({ dueAt: { $gte: now, $lte: upper }, status: 'pending' }).populate('patient', 'name email notificationPreferences').populate('practitioner', 'name email notificationPreferences').lean();
  for (const followUp of followUps) {
    const recipients = [followUp.patient, followUp.practitioner].filter((user) => user && user.notificationPreferences?.followUpReminders !== false);
    await notifyUsers(recipients.map((user) => user._id), 'follow-up-scheduled', 'Follow-up reminder', `A follow-up is scheduled for ${new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: clinicTimezone }).format(followUp.dueAt)}.`, { dedupeKey: `follow-up-reminder:${followUp._id}`, scheduledAt: followUp.dueAt, reminder: 'follow-up' });
    await notifyAdmins('follow-up-scheduled', 'Pending follow-up reminder', 'A patient follow-up is due soon.', { dedupeKey: `follow-up-reminder-admin:${followUp._id}`, scheduledAt: followUp.dueAt });
  }
}

async function startNotificationWorker() {
  await Notification.createIndexes();
  cron.schedule('*/5 * * * *', async () => {
    try { await runNotificationSweep(); }
    catch (error) { console.error('Notification worker failed:', error.name); }
  }, { timezone: clinicTimezone });
}

module.exports = { startNotificationWorker, runNotificationSweep, clinicLocalDateTime };
