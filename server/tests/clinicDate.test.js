const test = require('node:test');
const assert = require('node:assert/strict');
const { getClinicDateBounds } = require('../utils/clinicDate');

test('clinic calendar date and registration timestamp bounds use the clinic timezone', () => {
  const bounds = getClinicDateBounds(new Date('2026-11-23T10:00:00.000Z'), 'Asia/Kolkata');
  assert.equal(bounds.date, '2026-11-23');
  assert.equal(bounds.timestampStart.toISOString(), '2026-11-22T18:30:00.000Z');
  assert.equal(bounds.timestampEnd.toISOString(), '2026-11-23T18:30:00.000Z');
  assert.equal(bounds.calendarStart.toISOString(), '2026-11-23T00:00:00.000Z');
  assert.equal(bounds.calendarEnd.toISOString(), '2026-11-24T00:00:00.000Z');
});

test('clinic timestamp bounds account for daylight saving transitions', () => {
  const bounds = getClinicDateBounds(new Date('2026-03-08T16:00:00.000Z'), 'America/New_York');
  assert.equal(bounds.date, '2026-03-08');
  assert.equal(bounds.timestampStart.toISOString(), '2026-03-08T05:00:00.000Z');
  assert.equal(bounds.timestampEnd.toISOString(), '2026-03-09T04:00:00.000Z');
});

test('clinic calendar defaults to Asia/Kolkata when no timezone is configured', () => {
  const previousClinicTimezone = process.env.CLINIC_TIMEZONE;
  const previousSystemTimezone = process.env.TZ;
  delete process.env.CLINIC_TIMEZONE;
  delete process.env.TZ;
  try {
    const bounds = getClinicDateBounds(new Date('2026-11-23T20:00:00.000Z'));
    assert.equal(bounds.date, '2026-11-24');
    assert.equal(bounds.timestampStart.toISOString(), '2026-11-23T18:30:00.000Z');
  } finally {
    if (previousClinicTimezone === undefined) delete process.env.CLINIC_TIMEZONE;
    else process.env.CLINIC_TIMEZONE = previousClinicTimezone;
    if (previousSystemTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousSystemTimezone;
  }
});
