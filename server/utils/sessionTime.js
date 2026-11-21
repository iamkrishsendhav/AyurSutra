const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minuteOfDay(value) {
  const match = TIME_PATTERN.exec(String(value || ''));
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function overlaps(startA, durationA, startB, durationB) {
  const a = minuteOfDay(startA);
  const b = minuteOfDay(startB);
  if (a === null || b === null || !Number.isFinite(durationA) || !Number.isFinite(durationB)) return true;
  return a < b + durationB && a + durationA > b;
}

module.exports = { minuteOfDay, overlaps };
