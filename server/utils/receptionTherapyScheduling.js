function practitionerCoversTime(practitioner, date, startTime, durationMins) {
  const schedule = practitioner?.availabilitySchedule || [];
  if (!schedule.length) return true; // Published slots are the availability source when no weekly hours are set.
  const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(date).getUTCDay()];
  const availability = schedule.find((item) => item.dayOfWeek === day && item.isAvailable);
  if (!availability) return false;
  const minutes = (value) => {
    if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
    const [hours, mins] = value.split(':').map(Number);
    return hours * 60 + mins;
  };
  const start = minutes(startTime);
  const availableFrom = minutes(availability.startTime);
  const availableUntil = minutes(availability.endTime);
  return start !== null && availableFrom !== null && availableUntil !== null && start >= availableFrom && start + Number(durationMins || 60) <= availableUntil;
}

function practitionerHasSkills(practitioner, requiredSkills = []) {
  const skills = [...(practitioner?.practiceAreas || []), ...(practitioner?.qualifications || [])].map((skill) => String(skill).trim().toLowerCase());
  return requiredSkills.every((skill) => skills.includes(String(skill).trim().toLowerCase()));
}

function validScheduleDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

module.exports = { practitionerCoversTime, practitionerHasSkills, validScheduleDate };
