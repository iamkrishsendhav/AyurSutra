const dateParts = (instant, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map(({ type, value }) => [type, Number(value)]));
};

const dateKey = ({ year, month, day }) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const localMidnightAsUtc = (key, timeZone) => {
  const [year, month, day] = key.split('-').map(Number);
  const targetWallTime = Date.UTC(year, month - 1, day);
  let candidate = targetWallTime;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const fields = Object.fromEntries(formatter.formatToParts(new Date(candidate))
      .filter((part) => part.type !== 'literal').map(({ type, value }) => [type, Number(value)]));
    const representedWallTime = Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute, fields.second);
    const adjustment = targetWallTime - representedWallTime;
    if (adjustment === 0) break;
    candidate += adjustment;
  }
  return new Date(candidate);
};

const nextDateKey = (key) => {
  const [year, month, day] = key.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return dateKey({ year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() });
};

function getClinicDateBounds(instant = new Date(), timeZone = process.env.CLINIC_TIMEZONE || process.env.TZ || 'Asia/Kolkata') {
  const key = dateKey(dateParts(instant, timeZone));
  const nextKey = nextDateKey(key);
  return {
    date: key,
    timestampStart: localMidnightAsUtc(key, timeZone),
    timestampEnd: localMidnightAsUtc(nextKey, timeZone),
    // TherapySession.date stores the clinic's calendar day at UTC midnight.
    calendarStart: new Date(`${key}T00:00:00.000Z`),
    calendarEnd: new Date(`${nextKey}T00:00:00.000Z`),
  };
}

module.exports = { getClinicDateBounds };
