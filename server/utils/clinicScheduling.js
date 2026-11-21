const ClinicSettings = require('../models/ClinicSettings');

const minuteOfDay = (value) => {
  const [hours, minutes] = String(value).split(':').map(Number);
  return hours * 60 + minutes;
};

async function validateClinicSlot({ date, startTime, durationMins }, session) {
  const query = ClinicSettings.findOne({ key: 'clinic' });
  if (session) query.session(session);
  const settings = await query.lean();
  if (!settings) return null;
  const slotDate = new Date(date);
  if (!Number.isFinite(slotDate.getTime())) return 'Invalid session date';
  if (settings.workingDays?.length && !settings.workingDays.includes(slotDate.getUTCDay())) return 'The clinic is closed on the selected day';
  const startsAt = minuteOfDay(startTime);
  const endsAt = startsAt + Number(durationMins || settings.defaultSessionDurationMins || 60);
  if (settings.openingTime && startsAt < minuteOfDay(settings.openingTime)) return 'Session starts before clinic opening hours';
  if (settings.closingTime && endsAt > minuteOfDay(settings.closingTime)) return 'Session ends after clinic closing hours';
  const now = Date.now();
  const slotStart = new Date(slotDate);
  slotStart.setUTCHours(Math.floor(startsAt / 60), startsAt % 60, 0, 0);
  if (settings.minBookingNoticeMins != null && slotStart.getTime() - now < settings.minBookingNoticeMins * 60000) return 'The selected session does not meet the clinic booking notice period';
  if (settings.maxAdvanceDays != null && slotStart.getTime() - now > settings.maxAdvanceDays * 86400000) return 'The selected session is outside the clinic booking window';
  return null;
}

async function getClinicSettings(session) {
  const query = ClinicSettings.findOne({ key: 'clinic' });
  if (session) query.session(session);
  return query.lean();
}

module.exports = { validateClinicSlot, getClinicSettings };
