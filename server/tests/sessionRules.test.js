const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET ||= require('node:crypto').randomBytes(32).toString('hex');
const auth = require('../middleware/auth');
const User = require('../models/User');
const practitionerAuth = require('../middleware/practitionerAuth');
const { overlaps, minuteOfDay } = require('../utils/sessionTime');
const { canTransition } = require('../utils/sessionLifecycle');
const { canManageSession, canCancelSession } = require('../utils/sessionAccess');
const { practitionerCoversTime, practitionerHasSkills, validScheduleDate } = require('../utils/receptionTherapyScheduling');

function responseMock() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('JWT middleware rejects absent and invalid tokens and accepts a valid token', async () => {
  for (const token of [undefined, 'invalid']) {
    const req = { header: () => token };
    const res = responseMock();
    let nextCalled = false;
    await auth(req, res, () => { nextCalled = true; });
    assert.equal(res.statusCode, 401);
    assert.equal(nextCalled, false);
  }
  const originalFindById = User.findById;
  try {
    User.findById = () => ({ select: () => ({ lean: async () => ({ _id: 'patient-id', userType: 'patient', accountStatus: 'active' }) }) });
    const token = jwt.sign({ user: { _id: 'patient-id', userType: 'admin' } }, process.env.JWT_SECRET);
    const req = { header: () => token };
    const res = responseMock();
    let nextCalled = false;
    await auth(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(req.user._id, 'patient-id');
    assert.equal(req.user.userType, 'patient', 'authorization role must be read from MongoDB, not JWT claims');

    User.findById = () => ({ select: () => ({ lean: async () => ({ _id: 'patient-id', userType: 'patient', accountStatus: 'suspended' }) }) });
    const suspendedResponse = responseMock(); let suspendedNext = false;
    await auth({ header: () => token }, suspendedResponse, () => { suspendedNext = true; });
    assert.equal(suspendedResponse.statusCode, 403);
    assert.equal(suspendedNext, false);
  } finally { User.findById = originalFindById; }
});

test('JWT middleware resolves every supported role from the current database record', async () => {
  const originalFindById = User.findById;
  try {
    for (const userType of ['patient', 'practitioner', 'receptionist', 'admin']) {
      User.findById = () => ({ select: () => ({ lean: async () => ({ _id: `${userType}-id`, name: 'Role Test', userType, accountStatus: 'active' }) }) });
      const token = jwt.sign({ user: { _id: `${userType}-id`, userType: 'patient' } }, process.env.JWT_SECRET);
      const req = { header: () => token };
      const res = responseMock();
      let nextCalled = false;
      await auth(req, res, () => { nextCalled = true; });
      assert.equal(nextCalled, true, `${userType} should authenticate`);
      assert.equal(req.user.userType, userType, `${userType} must come from the database identity`);
    }
  } finally { User.findById = originalFindById; }
});

test('practitioner middleware rejects patients and permits practitioners', () => {
  for (const userType of ['patient', 'admin']) {
    const res = responseMock();
    let nextCalled = false;
    practitionerAuth({ user: { userType } }, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
  }
  let allowed = false;
  practitionerAuth({ user: { userType: 'practitioner' } }, responseMock(), () => { allowed = true; });
  assert.equal(allowed, true);
});

test('interval overlap rejects conflicts while allowing back-to-back sessions', () => {
  assert.equal(overlaps('09:30', 60, '10:00', 30), true);
  assert.equal(overlaps('09:30', 60, '10:30', 30), false);
  assert.equal(overlaps('10:30', 30, '09:30', 60), false);
  assert.equal(minuteOfDay('24:00'), null);
});

test('session lifecycle allows only forward progression and cancellation', () => {
  assert.equal(canTransition('scheduled', 'confirmed'), true);
  assert.equal(canTransition('confirmed', 'in-progress'), true);
  assert.equal(canTransition('in-progress', 'completed'), true);
  assert.equal(canTransition('scheduled', 'completed'), false);
  assert.equal(canTransition('completed', 'cancelled'), false);
  assert.equal(canTransition('scheduled', 'cancelled'), true);
});

test('session access enforces patient ownership and assigned practitioner identity', () => {
  const session = { patient: { _id: 'patient-1' }, practitioner: 'practitioner-1', status: 'scheduled' };
  assert.equal(canManageSession({ _id: 'patient-1', userType: 'patient' }, session), true);
  assert.equal(canManageSession({ _id: 'patient-2', userType: 'patient' }, session), false);
  assert.equal(canManageSession({ _id: 'practitioner-1', userType: 'practitioner' }, session), true);
  assert.equal(canManageSession({ _id: 'practitioner-2', userType: 'practitioner' }, session), false);
  const delegatedSession = { patient: { _id: 'patient-1', assignedPractitioner: 'primary-doctor' }, practitioner: 'execution-vaidya', status: 'scheduled' };
  assert.equal(canManageSession({ _id: 'execution-vaidya', userType: 'practitioner' }, delegatedSession), true);
  assert.equal(canManageSession({ _id: 'primary-doctor', userType: 'practitioner' }, delegatedSession), false);
  assert.equal(canManageSession({ _id: 'admin-1', userType: 'admin' }, session), true);
  assert.equal(canCancelSession({ _id: 'patient-1', userType: 'patient' }, session), true);
  assert.equal(canCancelSession({ _id: 'patient-1', userType: 'patient' }, { ...session, status: 'confirmed' }), false);
});

test('reception therapy scheduling validates published-slot availability, skills, and dates', () => {
  const vaidya = {
    practiceAreas: ['Abhyanga'],
    availabilitySchedule: [{ dayOfWeek: 'Tuesday', startTime: '09:00', endTime: '13:00', isAvailable: true }],
  };
  const tuesday = new Date('2026-11-24T00:00:00.000Z');
  assert.equal(practitionerCoversTime(vaidya, tuesday, '10:00', 90), true);
  assert.equal(practitionerCoversTime(vaidya, tuesday, '12:00', 90), false);
  assert.equal(practitionerHasSkills(vaidya, ['abhyanga']), true);
  assert.equal(practitionerHasSkills(vaidya, ['Virechana']), false);
  assert.equal(validScheduleDate('2026-11-25'), true);
  assert.equal(validScheduleDate('2026-02-30'), false);
});
