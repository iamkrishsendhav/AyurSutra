// Explicitly opt-in integration test. Uses a separate per-run database derived
// from MONGODB_URI and cleans up only records created by this run.
require('dotenv').config();
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { getJwtSecret } = require('../config/jwt');

const main = async () => {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  const isolatedUri = new URL(process.env.MONGODB_URI);
  const databaseName = `ayursutra_workflow_test_${process.pid}`;
  isolatedUri.pathname = `/${databaseName}`;
  await mongoose.connect(isolatedUri.toString(), { serverSelectionTimeoutMS: 10000 });
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName && !hello.msg?.includes('isdbgrid')) throw new Error('MongoDB deployment does not support transactions');

  const User = require('../models/User');
  const DoctorAssessment = require('../models/DoctorAssessment');
  const TreatmentPlan = require('../models/TreatmentPlan');
  const TherapySession = require('../models/TherapySession');
  const TherapyCatalogueItem = require('../models/TherapyCatalogueItem');
  const ScheduleLock = require('../models/ScheduleLock');
  const Message = require('../models/Message');
  const Notification = require('../models/Notification');
  const { app } = require('../server');
  const server = await new Promise((resolve) => { const listener = app.listen(0, () => resolve(listener)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const suffix = `${process.pid}@workflow-test.invalid`;
  let patient; let otherPatient; let doctor; let otherDoctor; let secondDoctor; let admin; let receptionist; let staffPractitioner; let plan; let adminPlan; let assessment; let reminderSession; let slotA; let slotB; let slotC; let slotD; let slotE; let slotF; let slotG;
  const tokenFor = (user) => jwt.sign({ user: { _id: user._id, userType: user.userType, email: user.email } }, getJwtSecret(), { expiresIn: '10m' });
  const request = async (path, user, method = 'GET', body) => {
    const response = await fetch(origin + path, { method, headers: { ...(user ? { 'x-auth-token': tokenFor(user) } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let responseBody;
    try { responseBody = await response.json(); } catch { throw new Error(`Non-JSON response from ${method} ${path} (${response.status})`); }
    return { status: response.status, body: responseBody };
  };

  try {
    patient = await User.create({ name: 'Workflow Test Patient', email: `patient-${suffix}`, password: 'not-a-real-login-password', userType: 'patient' });
    otherPatient = await User.create({ name: 'Other Workflow Patient', email: `patient-other-${suffix}`, password: 'not-a-real-login-password', userType: 'patient' });
    doctor = await User.create({ name: 'Workflow Test Practitioner', email: `doctor-${suffix}`, password: 'not-a-real-login-password', userType: 'practitioner', verificationStatus: 'verified', practiceAreas: ['Virechana'] });
    otherDoctor = await User.create({ name: 'Unassigned Test Practitioner', email: `other-${suffix}`, password: 'not-a-real-login-password', userType: 'practitioner' });
    secondDoctor = await User.create({ name: 'Second Test Practitioner', email: `doctor-second-${suffix}`, password: 'not-a-real-login-password', userType: 'practitioner' });
    const adminPassword = 'Workflow-admin-test-123!';
    admin = await User.create({ name: 'Workflow Test Admin', email: `admin-${suffix}`, password: await bcrypt.hash(adminPassword, 12), userType: 'admin' });
    const adminLogin = await request('/api/auth/login', null, 'POST', { email: admin.email, password: adminPassword, expectedRole: 'admin' });
    assert.equal(adminLogin.status, 200, 'admin login must authenticate the existing admin role');
    assert.equal(adminLogin.body.userType, 'admin');
    assert.equal((await request('/api/admin/staff', admin)).status, 200, 'authenticated admin can manage staff');
    assert.equal((await request('/api/admin/staff', null)).status, 401, 'staff management must reject anonymous users');
    assert.equal((await request('/api/admin/staff', admin, 'POST', { name: 'Publicly Created Admin', email: `new-admin-${suffix}`, password: 'Admin-test-password-123!', userType: 'admin' })).status, 400, 'staff API cannot create additional admin accounts');
    const publicSignup = await request('/api/auth/signup', null, 'POST', { name: 'Public Role Test', email: `signup-${suffix}`, password: 'Patient-login-123!', userType: 'admin', gender: 'other' });
    assert.equal(publicSignup.status, 200);
    const publicPatient = await User.findOne({ email: `signup-${suffix}` });
    assert.equal(publicPatient.userType, 'patient', 'public registration must ignore submitted privileged roles');
    assert.equal(await bcrypt.compare('Patient-login-123!', publicPatient.password), true, 'patient registration must store a bcrypt hash');
    const patientLogin = await request('/api/auth/login', null, 'POST', { email: publicPatient.email, password: 'Patient-login-123!', expectedRole: 'patient' });
    assert.equal(patientLogin.status, 200, 'patient login must work through the patient portal');
    assert.equal(patientLogin.body.userType, 'patient');
    assert.equal((await request('/api/admin/staff', publicPatient)).status, 403, 'staff management must reject patients');
    const patientProfile = await request('/api/profile', publicPatient);
    assert.equal(patientProfile.status, 200, 'patient profile endpoint must support authenticated session restoration');
    assert.equal(patientProfile.body.userType, 'patient');
    assert.equal((await request('/api/dashboard/patient', publicPatient)).status, 200, 'patient dashboard API must use the authenticated patient');
    assert.equal((await request('/api/auth/login', null, 'POST', { email: publicPatient.email, password: 'Patient-login-123!', expectedRole: 'receptionist' })).status, 403);
    await User.deleteOne({ _id: publicPatient._id });

    const staffPractitionerResponse = await request('/api/admin/staff', admin, 'POST', { name: 'Workflow Staff Practitioner', email: `staff-doctor-${suffix}`, phone: '+911234567891', password: 'Practitioner-test-123!', userType: 'practitioner' });
    assert.equal(staffPractitionerResponse.status, 201, 'only an admin can create practitioner staff');
    staffPractitioner = await User.findById(staffPractitionerResponse.body.staff._id);
    assert.equal(staffPractitioner.userType, 'practitioner');
    assert.equal(staffPractitioner.mustChangePassword, true);
    const practitionerLogin = await request('/api/auth/login', null, 'POST', { email: staffPractitioner.email, password: 'Practitioner-test-123!', expectedRole: 'practitioner' });
    assert.equal(practitionerLogin.status, 200, 'practitioner login must work through the Vaidya portal');
    assert.equal(practitionerLogin.body.userType, 'practitioner');
    assert.equal((await request('/api/profile', staffPractitioner)).body.userType, 'practitioner', 'practitioner profile endpoint must support authenticated session restoration');
    const lockedPractitionerDashboard = await request(`/api/dashboard/practitioner/${staffPractitioner._id}`, staffPractitioner);
    assert.equal(lockedPractitionerDashboard.status, 403, 'staff dashboard access must wait until initial password setup');
    assert.equal(lockedPractitionerDashboard.body.mustChangePassword, true);
    const practitionerPasswordChange = await request('/api/auth/change-password', staffPractitioner, 'POST', { currentPassword: 'Practitioner-test-123!', newPassword: 'Practitioner-new-password-123!', confirmPassword: 'Practitioner-new-password-123!' });
    assert.equal(practitionerPasswordChange.status, 200);
    assert.equal((await User.findById(staffPractitioner._id)).mustChangePassword, false);
    assert.equal((await request(`/api/dashboard/practitioner/${staffPractitioner._id}`, staffPractitioner)).status, 200, 'practitioner dashboard must use its authenticated identity after password setup');
    assert.equal((await request(`/api/dashboard/practitioner/${staffPractitioner._id}`, patient)).status, 403, 'patients cannot access practitioner dashboards');
    assert.equal((await request('/api/auth/login', null, 'POST', { email: staffPractitioner.email, password: 'Practitioner-new-password-123!', expectedRole: 'admin' })).status, 403);

    const staffResponse = await request('/api/admin/staff', admin, 'POST', { name: 'Workflow Receptionist', email: `reception-${suffix}`, phone: '+911234567890', password: 'Reception-test-123!', userType: 'receptionist', employeeId: 'WF-01' });
    assert.equal(staffResponse.status, 201);
    receptionist = await User.findById(staffResponse.body.staff._id);
    assert.equal(receptionist.userType, 'receptionist');
    assert.equal(receptionist.employeeId, 'WF-01');
    assert.equal(receptionist.mustChangePassword, true);
    assert.equal(await bcrypt.compare('Reception-test-123!', receptionist.password), true);
    assert.equal((await request('/api/admin/staff', receptionist)).status, 403);
    const lockedWorkspace = await request('/api/receptionist/patients', receptionist);
    assert.equal(lockedWorkspace.status, 403);
    assert.equal(lockedWorkspace.body.mustChangePassword, true);
    const receptionistLogin = await request('/api/auth/login', null, 'POST', { email: receptionist.email, password: 'Reception-test-123!', expectedRole: 'receptionist' });
    assert.equal(receptionistLogin.status, 200);
    let receptionistToken = receptionistLogin.body.token;
    assert.equal(receptionistLogin.body.mustChangePassword, true);
    const passwordChanged = await request('/api/auth/change-password', receptionist, 'POST', { currentPassword: 'Reception-test-123!', newPassword: 'Reception-new-password-123!', confirmPassword: 'Reception-new-password-123!' });
    assert.equal(passwordChanged.status, 200);
    assert.equal((await User.findById(receptionist._id)).mustChangePassword, false);
    assert.equal((await request('/api/auth/login', null, 'POST', { email: receptionist.email, password: 'Reception-test-123!', expectedRole: 'receptionist' })).status, 400);
    const updatedLogin = await request('/api/auth/login', null, 'POST', { email: receptionist.email, password: 'Reception-new-password-123!', expectedRole: 'receptionist' });
    assert.equal(updatedLogin.status, 200); receptionistToken = updatedLogin.body.token;
    await User.updateOne({ _id: receptionist._id }, { $set: { accountStatus: 'suspended' } });
    assert.equal((await request('/api/profile', receptionist)).status, 403, 'suspending an account must revoke existing JWT access');
    assert.equal((await request('/api/auth/login', null, 'POST', { email: receptionist.email, password: 'Reception-new-password-123!', expectedRole: 'receptionist' })).status, 403);
    await User.updateOne({ _id: receptionist._id }, { $set: { accountStatus: 'active' } });
    assert.equal((await fetch(origin + '/api/profile', { headers: { 'x-auth-token': receptionistToken } })).status, 200);
    const assignmentResponse = await request('/api/practitioner-search/assign', patient, 'POST', { practitionerId: doctor._id });
    assert.equal(assignmentResponse.status, 200);
    assert.ok(await Notification.findOne({ user: patient._id, type: 'patient-assigned' }));
    assert.ok(await Notification.findOne({ user: doctor._id, type: 'patient-assigned' }));

    // Authenticated notification ownership, persisted preferences and secure conversation access.
    assert.equal((await request('/api/notifications', null)).status, 401);
    let communication = await request('/api/messages', patient, 'POST', { fromId: otherPatient._id, toId: doctor._id, text: 'Workflow test message' });
    assert.equal(communication.status, 201);
    const savedMessage = await Message.findById(communication.body._id).lean();
    assert.equal(String(savedMessage.from), String(patient._id), 'sender must come from JWT, not request body');
    assert.equal((await request('/api/messages', otherPatient, 'POST', { toId: doctor._id, text: 'Unauthorized test' })).status, 403);
    assert.equal((await request('/api/messages', doctor, 'POST', { toId: otherPatient._id, text: 'Unassigned reply' })).status, 403);
    assert.equal((await request(`/api/messages/conversation?userAId=${otherPatient._id}&userBId=${doctor._id}`, patient)).status, 403);
    communication = await request(`/api/messages/conversation?otherUserId=${patient._id}`, doctor);
    assert.equal(communication.status, 200); assert.equal(communication.body.length, 1);
    assert.equal((await Message.findById(savedMessage._id).lean()).read, true, 'opening the conversation marks incoming message read');
    assert.equal((await request('/api/messages/inbox?userId=' + doctor._id, patient)).body.messages.length, 0, 'client user id cannot change inbox identity');
    const messageNotification = await Notification.findOne({ user: doctor._id, type: 'message-received' }).lean();
    assert.ok(messageNotification, 'new secure messages create an in-app notification');
    assert.equal((await request(`/api/notifications/${messageNotification._id}/read`, otherPatient, 'POST')).status, 404);
    assert.equal((await request(`/api/notifications/${messageNotification._id}/read`, doctor, 'POST')).status, 200);
    assert.equal((await Notification.findById(messageNotification._id).lean()).read, true);
    assert.equal((await request('/api/notifications/preferences', patient)).status, 200);

    const timezone = process.env.CLINIC_TIMEZONE || process.env.TZ || 'Asia/Kolkata';
    const localParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
    const reminderLocal = new Date(Date.UTC(localParts.year, localParts.month - 1, localParts.day, localParts.hour, localParts.minute) + 30 * 60000);
    const reminderDate = `${reminderLocal.getUTCFullYear()}-${String(reminderLocal.getUTCMonth() + 1).padStart(2, '0')}-${String(reminderLocal.getUTCDate()).padStart(2, '0')}`;
    const reminderTime = `${String(reminderLocal.getUTCHours()).padStart(2, '0')}:${String(reminderLocal.getUTCMinutes()).padStart(2, '0')}`;
    reminderSession = await TherapySession.create({ patient: patient._id, practitioner: doctor._id, therapyType: 'Reminder test', phase: 'Pre', sessionName: 'Reminder test session', date: new Date(`${reminderDate}T00:00:00.000Z`), startTime: reminderTime, durationMins: 60, status: 'scheduled' });
    const { runNotificationSweep } = require('../workers/notificationWorker');
    await runNotificationSweep(); await runNotificationSweep();
    assert.equal(await Notification.countDocuments({ session: reminderSession._id, type: 'session-reminder' }), 2, 'session reminders are one-per-recipient and idempotent');
    await TherapySession.updateOne({ _id: reminderSession._id }, { $set: { status: 'cancelled' } });
    await runNotificationSweep();
    assert.equal(await Notification.countDocuments({ session: reminderSession._id, type: 'session-reminder' }), 2, 'cancelled sessions do not generate reminders');
    await Notification.deleteMany({ session: reminderSession._id });
    await TherapySession.deleteOne({ _id: reminderSession._id }); reminderSession = null;

    communication = await request('/api/notifications/preferences', patient, 'PUT', { inApp: false, categories: { 'message-received': false } });
    assert.equal(communication.status, 200);
    assert.equal((await User.findById(patient._id).select('notificationPreferences').lean()).notificationPreferences.inApp, false);
    assert.equal((await request('/api/notifications/preferences', patient, 'PUT', { categories: { 'account-update': false } })).status, 400, 'security and account notices remain protected');

    let response = await request('/api/profile', patient);
    assert.equal(response.status, 200);
    response = await request('/api/profile', patient, 'PUT', { phone: '555-0100', medicalHistory: { conditions: ['test condition'], allergies: ['test allergy'], medications: [], previousTreatments: [], healthNotes: 'Test-only health note' } });
    assert.equal(response.status, 200);
    const savedProfile = await User.findById(patient._id).lean();
    assert.equal(savedProfile.medicalHistory.conditions[0], 'test condition');
    assert.equal(savedProfile.medicalHistory.healthNotes, 'Test-only health note');
    assert.equal((await request('/api/admin/patients', patient)).status, 403);
    response = await request('/api/admin/patients', admin);
    assert.equal(response.status, 200);
    assert.ok(response.body.patients.some((item) => String(item._id) === String(patient._id)));

    assert.equal((await request('/api/treatment-plans/patients/' + patient.id + '/assessments', null)).status, 401);
    assert.equal((await request('/api/treatment-plans/patients/' + patient.id + '/assessments', otherDoctor)).status, 403);
    assert.equal((await request(`/api/treatment-plans/patients/${patient.id}/assessments`, patient, 'POST', { diagnosis: 'Must not create' })).status, 403);
    assert.equal((await request(`/api/treatment-plans/patients/${patient.id}/assessments`, otherPatient)).status, 403);
    assert.equal((await request(`/api/treatment-plans/patients/${patient.id}/assessments`, admin)).status, 200);
    response = await request(`/api/treatment-plans/patients/${patient.id}/assessments`, doctor, 'POST', { diagnosis: 'Test diagnosis', observations: 'Test observation', symptoms: ['test'] });
    assert.equal(response.status, 201); assessment = response.body.assessment;
    assert.equal(String(await DoctorAssessment.findById(assessment._id).then((x) => x.patient)), String(patient._id));
    assert.equal((await request(`/api/treatment-plans/patients/${patient.id}/assessments`, patient)).status, 200);
    assert.equal((await request(`/api/treatment-plans/patients/${patient.id}`, otherPatient)).status, 403);
    assert.equal((await request(`/api/treatment-plans/patients/${patient.id}`, patient, 'POST', {})).status, 403);
    assert.equal((await request(`/api/treatment-plans/patients/${new mongoose.Types.ObjectId()}/assessments`, patient)).status, 404);

    const startDate = new Date(); startDate.setDate(startDate.getDate() + 5);
    response = await request(`/api/treatment-plans/patients/${patient.id}`, doctor, 'POST', { assessmentId: assessment._id, startDate: startDate.toISOString().slice(0, 10), therapies: [{ therapyType: 'Virechana', sessionName: 'Test therapy', phase: 'Pre', durationMins: 45, frequencyDays: 1, occurrences: 2, startTime: '10:00', instructions: 'Test only' }] });
    assert.equal(response.status, 201); plan = response.body.plan;
    assert.equal(plan.status, 'pending-approval');
    assert.ok(await Notification.findOne({ user: admin._id, type: 'plan-submitted' }));
    assert.equal((await request(`/api/treatment-plans/${plan._id}/generate-sessions`, doctor, 'POST')).status, 409);
    assert.equal((await request(`/api/treatment-plans/${plan._id}/review`, otherDoctor, 'POST', { decision: 'approved' })).status, 404);
    assert.equal((await request(`/api/treatment-plans/${plan._id}/review`, patient, 'POST', { decision: 'approved' })).status, 403);
    response = await request(`/api/treatment-plans/${plan._id}/review`, doctor, 'POST', { decision: 'approved' });
    assert.equal(response.status, 200); assert.equal(response.body.plan.status, 'approved');
    assert.equal(response.body.plan.reviewHistory.length, 1);
    assert.equal((await request(`/api/treatment-plans/${plan._id}/review`, doctor, 'POST', { decision: 'approved' })).status, 404);
    assert.equal((await TreatmentPlan.findById(plan._id).lean()).reviewHistory.length, 1);

    // Reception schedules an individual approved-plan occurrence with a Vaidya
    // different from the patient's primary clinician; that Vaidya owns execution.
    await User.updateOne({ _id: secondDoctor._id }, { $set: { verificationStatus: 'verified', professionalStatus: 'active', practiceAreas: ['Virechana'] } });
    const therapySlotDate = startDate.toISOString().slice(0, 10);
    assert.equal((await request('/therapy/create', secondDoctor, 'POST', { date: therapySlotDate, times: ['10:00', '11:00'] })).status, 200);
    const approvedPlans = await request(`/api/receptionist/patients/${patient._id}/approved-treatment-plans`, receptionist);
    assert.equal(approvedPlans.status, 200);
    assert.equal(approvedPlans.body.plans.find((item) => String(item._id) === String(plan._id)).status, 'approved');
    assert.equal((await request(`/api/receptionist/patients/${patient._id}/approved-treatment-plans`, patient)).status, 403);
    assert.equal((await request(`/api/receptionist/patients/${patient._id}/approved-treatment-plans`, otherDoctor)).status, 403);
    const occurrenceQuery = `patientId=${patient._id}&planId=${plan._id}&therapyId=${plan.therapies[0]._id}&occurrence=0&date=${therapySlotDate}`;
    const therapyAvailability = await request(`/api/receptionist/therapy-availability?${occurrenceQuery}`, receptionist);
    assert.equal(therapyAvailability.status, 200);
    assert.deepEqual(therapyAvailability.body.practitioners.map((item) => String(item._id)), [String(secondDoctor._id)]);
    assert.equal((await request(`/api/receptionist/therapy-availability?${occurrenceQuery}`, doctor)).status, 403);
    const chosenSlot = therapyAvailability.body.practitioners[0].slots.find((item) => item.startTime === '10:00');
    assert.ok(chosenSlot);
    let receptionTherapy = await request('/api/receptionist/therapy-sessions', receptionist, 'POST', { patientId: patient._id, planId: plan._id, therapyId: plan.therapies[0]._id, occurrence: 0, slotId: chosenSlot._id });
    assert.equal(receptionTherapy.status, 201);
    const receptionTherapySession = await TherapySession.findById(receptionTherapy.body.session._id).lean();
    assert.equal(String(receptionTherapySession.patient), String(patient._id));
    assert.equal(String(receptionTherapySession.practitioner), String(secondDoctor._id));
    assert.equal(String(receptionTherapySession.treatmentPlan), String(plan._id));
    assert.equal(receptionTherapySession.planSessionKey, '0:0');
    assert.equal(receptionTherapySession.durationMins, 45);
    assert.equal((await request('/sessions', secondDoctor)).body.some((item) => String(item._id) === String(receptionTherapySession._id)), true);
    assert.equal((await request('/sessions', doctor)).body.some((item) => String(item._id) === String(receptionTherapySession._id)), false);
    assert.equal((await request(`/api/receptionist/appointments?date=${therapySlotDate}`, receptionist)).body.appointments.some((item) => String(item._id) === String(receptionTherapySession._id)), true);
    const duplicateOccurrenceSlot = therapyAvailability.body.practitioners[0].slots.find((item) => item.startTime === '11:00');
    assert.ok(duplicateOccurrenceSlot);
    receptionTherapy = await request('/api/receptionist/therapy-sessions', receptionist, 'POST', { patientId: patient._id, planId: plan._id, therapyId: plan.therapies[0]._id, occurrence: 0, slotId: duplicateOccurrenceSlot._id });
    assert.equal(receptionTherapy.status, 409, 'a prescribed occurrence cannot be scheduled twice');
    assert.equal((await request(`/api/receptionist/therapy-availability?${occurrenceQuery}`, receptionist)).body.practitioners.length, 0);
    response = await request(`/sessions/${receptionTherapySession._id}`, secondDoctor, 'PUT', { status: 'confirmed' });
    assert.equal(response.status, 200, 'the assigned Vaidya can accept the session even when the primary clinician differs');
    response = await request(`/sessions/${receptionTherapySession._id}`, secondDoctor, 'PUT', { status: 'in-progress' });
    assert.equal(response.status, 200);
    response = await request(`/sessions/${receptionTherapySession._id}/clinical-record`, secondDoctor, 'PATCH', { treatmentNotes: 'Workflow test execution note' });
    assert.equal(response.status, 200, 'the assigned Vaidya can save session notes');
    response = await request(`/sessions/${receptionTherapySession._id}`, secondDoctor, 'PUT', { status: 'completed' });
    assert.equal(response.status, 200);
    assert.equal((await TherapySession.findById(receptionTherapySession._id).lean()).statusHistory.length, 4);
    assert.equal((await request(`/sessions/${receptionTherapySession._id}`, doctor, 'PUT', { status: 'confirmed' })).status, 403, 'the primary clinician cannot execute another Vaidya\'s session');

    const adminPlanDate = new Date(startDate); adminPlanDate.setDate(adminPlanDate.getDate() + 10);
    response = await request(`/api/treatment-plans/patients/${patient.id}`, doctor, 'POST', { assessmentId: assessment._id, startDate: adminPlanDate.toISOString().slice(0, 10), therapies: [{ therapyType: 'Virechana', sessionName: 'Admin-reviewed test therapy', phase: 'Pre', durationMins: 45, frequencyDays: 1, occurrences: 1, startTime: '10:00' }] });
    assert.equal(response.status, 201); adminPlan = response.body.plan;
    response = await request(`/api/treatment-plans/${adminPlan._id}/review`, admin, 'POST', { decision: 'approved' });
    assert.equal(response.status, 200);
    assert.equal(response.body.plan.reviewHistory[0].reviewedBy.toString(), admin._id.toString());
    response = await request(`/api/admin/patients/${patient.id}`, admin);
    assert.equal(response.status, 200);
    assert.equal(response.body.summary.assessmentCount, 1);
    assert.equal(response.body.summary.plans.length, 2);

    const generated = await Promise.all([request(`/api/treatment-plans/${plan._id}/generate-sessions`, doctor, 'POST'), request(`/api/treatment-plans/${plan._id}/generate-sessions`, doctor, 'POST')]);
    assert.deepEqual(generated.map((x) => x.status).sort(), [201, 409]);
    const savedSessions = await TherapySession.find({ treatmentPlan: plan._id });
    assert.equal(savedSessions.length, 2);
    assert.ok(savedSessions.every((x) => String(x.patient) === String(patient._id)));
    assert.ok(savedSessions.some((x) => String(x.practitioner) === String(secondDoctor._id) && x.planSessionKey === '0:0'));
    assert.ok(savedSessions.some((x) => String(x.practitioner) === String(doctor._id) && x.planSessionKey === '0:1'));
    assert.equal((await request('/sessions', patient)).body.length, 2);
    assert.equal((await request('/sessions', doctor)).body.length, 1);
    assert.equal((await request('/sessions', secondDoctor)).body.length, 1);
    assert.equal((await request('/sessions', admin)).body.length, 2);
    assert.equal((await request('/sessions', otherPatient)).body.length, 0);
    const patientDashboard = await request('/api/dashboard/patient', patient);
    assert.equal(patientDashboard.status, 200);
    assert.equal(patientDashboard.body.total, 2);
    assert.equal(patientDashboard.body.completed, 1);
    assert.equal(patientDashboard.body.hasPractitioner, true);
    const practitionerDashboard = await request(`/api/dashboard/practitioner/${doctor.id}`, doctor);
    assert.equal(practitionerDashboard.status, 200);
    assert.equal(practitionerDashboard.body.totalSessions, 1);
    assert.equal(practitionerDashboard.body.completedSessions, 0);
    assert.equal(practitionerDashboard.body.upcomingSessions.length, 1);
    assert.equal((await request(`/api/dashboard/practitioner/${doctor.id}`, otherDoctor)).status, 403);
    assert.equal((await request(`/api/dashboard/practitioner/${doctor.id}`, patient)).status, 403);
    assert.equal((await request(`/api/dashboard/practitioner/${doctor.id}`, admin)).status, 200);
    assert.equal((await request('/api/admin/practitioners', patient)).status, 403);
    assert.equal((await request('/api/admin/practitioners', admin)).status, 200);
    assert.equal((await request('/api/admin/operations/overview', patient)).status, 403);
    response = await request('/api/admin/operations/overview', admin);
    assert.equal(response.status, 200);
    assert.equal(response.body.metrics.totalPatients, 2);
    assert.equal((await request('/api/admin/operations/plans?q=Workflow', admin)).status, 200);
    const reportFrom = new Date().toISOString().slice(0, 10); const reportToDate = new Date(); reportToDate.setDate(reportToDate.getDate() + 40); const reportTo = reportToDate.toISOString().slice(0, 10);
    const reportRange = `from=${reportFrom}&to=${reportTo}`;
    assert.equal((await request(`/api/admin/reports/analytics?${reportRange}`, patient)).status, 403);
    response = await request(`/api/admin/reports/analytics?${reportRange}`, admin);
    assert.equal(response.status, 200);
    assert.equal(response.body.metrics.totalPatients, 2);
    assert.equal(response.body.metrics.plannedSessions, 3);
    assert.equal(response.body.metrics.generatedSessions, 2);
    assert.equal(response.body.metrics.newPatients.changePercent, null);
    response = await request(`/api/admin/reports/patients?${reportRange}`, admin);
    assert.equal(response.status, 200); assert.equal(response.body.patients.length, 2);
    response = await request(`/api/admin/reports/patients/${patient.id}?${reportRange}`, admin);
    assert.equal(response.status, 200); assert.equal(response.body.patient.name, patient.name); assert.equal(Object.hasOwn(response.body.patient, 'medicalHistory'), false);
    assert.equal((await request(`/api/admin/reports/patients/${patient.id}?${reportRange}`, otherPatient)).status, 403);
    response = await request(`/api/admin/reports/export?type=sessions&${reportRange}`, admin);
    assert.equal(response.status, 200); assert.ok(response.body.rows.length >= 2); assert.equal(response.body.columns.includes('_id'), false);
    assert.equal((await request(`/api/admin/reports/export?type=patient-report&${reportRange}`, admin)).status, 400);
    assert.equal((await request(`/api/admin/reports/therapies?${reportRange}`, admin)).status, 200);
    assert.equal((await request(`/api/admin/reports/plans?${reportRange}&status=approved`, admin)).status, 200);
    assert.equal((await request('/api/therapies', patient)).status, 200);
    assert.equal((await request('/api/therapies', patient, 'POST', { name: 'Forbidden Test Therapy', category: 'Test', description: 'Test', durationMins: 60 })).status, 403);
    response = await request('/api/therapies', admin, 'POST', { name: `Catalogue Test ${process.pid}`, category: 'Test category', description: 'Integration test catalogue entry', durationMins: 75, requiredSkills: ['Virechana'], preparationInstructions: 'Test preparation', postTherapyInstructions: 'Test aftercare' });
    assert.equal(response.status, 201);
    const catalogTherapy = response.body.therapy;
    const catalogPlanDate = new Date(startDate); catalogPlanDate.setDate(catalogPlanDate.getDate() + 20);
    response = await request(`/api/treatment-plans/patients/${patient.id}`, doctor, 'POST', { assessmentId: assessment._id, startDate: catalogPlanDate.toISOString().slice(0, 10), therapies: [{ catalogTherapyId: catalogTherapy._id, sessionName: 'Catalogue-backed test session', phase: 'Main', durationMins: 1, frequencyDays: 1, occurrences: 1, startTime: '11:30' }] });
    assert.equal(response.status, 201); const catalogPlan = response.body.plan;
    assert.equal(catalogPlan.therapies[0].durationMins, 75);
    assert.equal(String(catalogPlan.therapies[0].catalogTherapy), String(catalogTherapy._id));
    assert.equal((await request(`/api/treatment-plans/${catalogPlan._id}/review`, doctor, 'POST', { decision: 'approved' })).status, 200);
    assert.equal((await request(`/api/treatment-plans/${catalogPlan._id}/generate-sessions`, doctor, 'POST')).status, 201);
    const catalogSession = await TherapySession.findOne({ treatmentPlan: catalogPlan._id }).lean();
    assert.equal(catalogSession.durationMins, 75);
    assert.equal(catalogSession.therapySnapshot.name, catalogTherapy.name);
    const availableSlots = await request('/therapy/available', otherPatient);
    assert.equal(availableSlots.status, 200);
    assert.equal(availableSlots.body.some((slot) => savedSessions.some((saved) => String(saved._id) === String(slot._id))), false);
    assert.equal((await request('/therapy/create', patient, 'POST', { date: '2030-01-01', times: ['09:00'] })).status, 403);

    const bookingDate = new Date(); bookingDate.setDate(bookingDate.getDate() + 10);
    slotA = await TherapySession.create({ practitioner: doctor._id, therapyType: 'Custom', phase: 'Pre', sessionName: 'General Slot', date: bookingDate, startTime: '14:00', durationMins: 60, status: 'scheduled' });
    slotB = await TherapySession.create({ practitioner: doctor._id, therapyType: 'Custom', phase: 'Pre', sessionName: 'General Slot', date: bookingDate, startTime: '14:30', durationMins: 60, status: 'scheduled' });
    const bookings = await Promise.all([request(`/therapy/book/${slotA.id}`, patient, 'POST', {}), request(`/therapy/book/${slotB.id}`, patient, 'POST', {})]);
    assert.equal(bookings.filter((x) => x.status === 200).length, 1, `booking responses: ${JSON.stringify(bookings.map((x) => ({ status: x.status, message: x.body.message || x.body.error })))}`);
    assert.equal(bookings.filter((x) => x.status === 409).length, 1, `booking response statuses: ${bookings.map((x) => x.status).join(',')}`);
    const bookedOverlaps = await TherapySession.find({ patient: patient._id, date: bookingDate, status: { $ne: 'cancelled' } });
    assert.equal(bookedOverlaps.length, 1);
    const practitionerRaceDate = new Date(); practitionerRaceDate.setDate(practitionerRaceDate.getDate() + 12);
    slotD = await TherapySession.create({ practitioner: doctor._id, therapyType: 'Custom', phase: 'Pre', sessionName: 'General Slot', date: practitionerRaceDate, startTime: '16:00', durationMins: 60, status: 'scheduled' });
    slotE = await TherapySession.create({ practitioner: doctor._id, therapyType: 'Custom', phase: 'Pre', sessionName: 'General Slot', date: practitionerRaceDate, startTime: '16:30', durationMins: 60, status: 'scheduled' });
    const practitionerRace = await Promise.all([request(`/therapy/book/${slotD.id}`, patient, 'POST', {}), request(`/therapy/book/${slotE.id}`, otherPatient, 'POST', {})]);
    assert.equal(practitionerRace.filter((x) => x.status === 200).length, 1);
    assert.equal(practitionerRace.filter((x) => x.status === 409).length, 1);

    const patientRaceDate = new Date(); patientRaceDate.setDate(patientRaceDate.getDate() + 13);
    slotF = await TherapySession.create({ practitioner: doctor._id, therapyType: 'Custom', phase: 'Pre', sessionName: 'General Slot', date: patientRaceDate, startTime: '17:00', durationMins: 60, status: 'scheduled' });
    slotG = await TherapySession.create({ practitioner: secondDoctor._id, therapyType: 'Custom', phase: 'Pre', sessionName: 'General Slot', date: patientRaceDate, startTime: '17:30', durationMins: 60, status: 'scheduled' });
    const patientRace = await Promise.all([request(`/therapy/book/${slotF.id}`, patient, 'POST', {}), request(`/therapy/book/${slotG.id}`, patient, 'POST', {})]);
    assert.equal(patientRace.filter((x) => x.status === 200).length, 1);
    assert.equal(patientRace.filter((x) => x.status === 409).length, 1);

    const bookedStart = Number(bookedOverlaps[0].startTime.slice(0, 2)) * 60 + Number(bookedOverlaps[0].startTime.slice(3));
    const backToBackMinute = bookedStart + (bookedOverlaps[0].durationMins || 60);
    const backToBackTime = `${String(Math.floor(backToBackMinute / 60)).padStart(2, '0')}:${String(backToBackMinute % 60).padStart(2, '0')}`;
    slotC = await TherapySession.create({ practitioner: doctor._id, therapyType: 'Custom', phase: 'Pre', sessionName: 'General Slot', date: bookingDate, startTime: backToBackTime, durationMins: 60, status: 'scheduled' });
    assert.equal((await request(`/therapy/book/${slotC.id}`, patient, 'POST', {})).status, 200);
    assert.equal((await request(`/sessions/${slotC.id}`, patient, 'PUT', { startTime: '14:15' })).status, 409);
    const movedDate = new Date(bookingDate.getTime() + 2 * 24 * 60 * 60 * 1000);
    const rescheduleResponse = await request(`/sessions/${slotC.id}`, patient, 'PUT', { date: movedDate.toISOString().slice(0, 10), startTime: '15:00' });
    assert.equal(rescheduleResponse.status, 200, JSON.stringify(rescheduleResponse.body));
    const rescheduled = await TherapySession.findById(slotC._id).lean();
    assert.equal(rescheduled.scheduleHistory.length, 1);
    assert.equal(rescheduled.scheduleHistory[0].changedBy.toString(), patient._id.toString());

    // Session execution record, one-time patient feedback, and follow-up ownership.
    const executionSession = savedSessions.find((item) => String(item.practitioner) === String(doctor._id));
    assert.ok(executionSession, 'the primary clinician receives only the remaining unscheduled plan occurrence');
    response = await request(`/sessions/${executionSession._id}`, doctor, 'PUT', { status: 'confirmed' });
    assert.equal(response.status, 200);
    response = await request(`/sessions/${executionSession._id}`, doctor, 'PUT', { status: 'in-progress' });
    assert.equal(response.status, 200);
    assert.ok((await TherapySession.findById(executionSession._id).lean()).clinicalRecord.actualStartedAt);
    response = await request(`/sessions/${executionSession._id}`, doctor, 'PUT', { status: 'completed' });
    assert.equal(response.status, 200);
    let executionRecord = await TherapySession.findById(executionSession._id).lean();
    assert.ok(executionRecord.clinicalRecord.actualCompletedAt);
    assert.equal(executionRecord.statusHistory.at(-1).status, 'completed');
    assert.equal((await request(`/sessions/${executionSession._id}/clinical-record`, otherDoctor, 'PATCH', { observations: 'Unauthorized' })).status, 403);
    response = await request(`/sessions/${executionSession._id}/clinical-record`, doctor, 'PATCH', { observations: 'Test-only observation', treatmentNotes: 'Test-only record', followUpRecommendations: 'Test-only review' });
    assert.equal(response.status, 200);
    assert.equal((await TherapySession.findById(executionSession._id).lean()).clinicalRecord.observations, 'Test-only observation');
    assert.equal((await request(`/sessions/${executionSession._id}/feedback`, otherPatient, 'POST', { rating: 5 })).status, 404);
    response = await request(`/sessions/${executionSession._id}/feedback`, patient, 'POST', { rating: 5, comments: 'Test-only feedback' });
    assert.equal(response.status, 201);
    assert.ok((await TherapySession.findById(executionSession._id).lean()).feedback.submittedAt);
    assert.equal((await request(`/sessions/${executionSession._id}/feedback`, patient, 'POST', { rating: 5 })).status, 409);
    assert.equal((await request('/api/admin/operations/feedback', patient)).status, 403);
    response = await request('/api/admin/operations/feedback', admin);
    assert.equal(response.status, 200);
    assert.ok(response.body.feedback.some((item) => String(item._id) === String(executionSession._id)));
    assert.equal((await request('/api/follow-ups', patient, 'POST', { patientId: patient.id, dueAt: new Date(Date.now() + 86400000), notes: 'Must be forbidden' })).status, 403);
    response = await request('/api/follow-ups', doctor, 'POST', { patientId: patient.id, sessionId: executionSession._id, dueAt: new Date(Date.now() + 86400000), notes: 'Test-only follow-up' });
    assert.equal(response.status, 201);
    const followUpId = response.body.followUp._id;
    assert.ok(await Notification.findOne({ user: doctor._id, type: 'follow-up-scheduled' }));
    assert.equal((await request('/api/follow-ups', otherPatient)).body.followUps.length, 0);
    assert.equal((await request(`/api/follow-ups/${followUpId}/complete`, otherDoctor, 'PATCH')).status, 403);
    assert.equal((await request(`/api/follow-ups/${followUpId}/complete`, doctor, 'PATCH')).status, 200);

    assert.equal((await request(`/api/admin/patients/${patient.id}/account-status`, doctor, 'PATCH', { accountStatus: 'suspended' })).status, 403);
    response = await request(`/api/admin/patients/${patient.id}/account-status`, admin, 'PATCH', { accountStatus: 'suspended' });
    assert.equal(response.status, 200);
    assert.equal(response.body.patient.accountStatus, 'suspended');
    assert.equal((await request('/api/admin/patients?accountStatus=suspended', admin)).body.patients.some((item) => String(item._id) === String(patient._id)), true);
    response = await request(`/api/admin/patients/${patient.id}/account-status`, admin, 'PATCH', { accountStatus: 'active' });
    assert.equal(response.status, 200);
    const statusRecord = await User.findById(patient._id).select('accountStatus accountStatusHistory').lean();
    assert.equal(statusRecord.accountStatus, 'active');
    assert.equal(statusRecord.accountStatusHistory.length, 2);

    const slotDay = new Date(bookingDate); slotDay.setDate(slotDay.getDate() + 20);
    const slotDate = slotDay.toISOString().slice(0, 10);
    assert.equal((await request('/api/admin/operations/settings', patient, 'PUT', { clinicName: 'Unauthorized' })).status, 403);
    const restrictedSlot = await TherapySession.create({ practitioner: doctor._id, therapyType: 'Virechana', phase: 'Pre', sessionName: 'Out-of-hours booking test', date: new Date(slotDate), startTime: '08:00', durationMins: 45, status: 'scheduled', isBooked: false, patient: null });
    response = await request('/api/admin/operations/settings', admin, 'PUT', { clinicName: 'Workflow Test Clinic', workingDays: [], openingTime: '09:00', closingTime: '17:00', defaultSessionDurationMins: 45, minBookingNoticeMins: null, maxAdvanceDays: null });
    assert.equal(response.status, 200);
    assert.equal((await request('/api/receptionist/patients', patient)).status, 403);
    const receptionPatientResponse = await request('/api/receptionist/patients', receptionist, 'POST', { name: 'Reception Test Patient', email: `frontdesk-${suffix}`, phone: '+919876543210', password: 'Frontdesk-Patient-123!', userType: 'admin' });
    assert.equal(receptionPatientResponse.status, 201);
    const receptionPatient = await User.findById(receptionPatientResponse.body.patient._id);
    assert.equal(receptionPatient.userType, 'patient', 'receptionist patient creation cannot set roles');
    assert.equal((await request(`/api/receptionist/patients?q=${encodeURIComponent(receptionPatient.email)}`, receptionist)).body.patients.length, 1);
    const availableVaidyas = await request('/api/receptionist/practitioners', receptionist);
    assert.equal(availableVaidyas.status, 200);
    assert.ok(availableVaidyas.body.practitioners.some((item) => String(item._id) === String(doctor._id)));
    assert.equal((await request('/api/receptionist/dashboard', receptionist)).status, 200);
    const receptionDay = new Date(slotDate); receptionDay.setUTCDate(receptionDay.getUTCDate() + 1);
    const receptionDate = receptionDay.toISOString().slice(0, 10);
    assert.equal((await request('/therapy/create', doctor, 'POST', { date: receptionDate, times: ['14:00', '16:00'] })).status, 200);
    const receptionDayEnd = new Date(`${receptionDate}T00:00:00.000Z`); receptionDayEnd.setUTCDate(receptionDayEnd.getUTCDate() + 1);
    const receptionSlots = await TherapySession.find({ practitioner: doctor._id, patient: null, date: { $gte: new Date(`${receptionDate}T00:00:00.000Z`), $lt: receptionDayEnd }, sessionName: 'General Slot' }).lean();
    assert.equal(receptionSlots.length, 2);
    let deskBooking = await request('/api/receptionist/appointments', receptionist, 'POST', { patientId: receptionPatient._id, slotId: receptionSlots.find((item) => item.startTime === '14:00')._id, therapyType: 'Clinic visit' });
    assert.equal(deskBooking.status, 201);
    const deskAppointmentId = deskBooking.body.appointment._id;
    const overlapBooking = await request('/api/receptionist/appointments', receptionist, 'POST', { patientId: receptionPatient._id, slotId: receptionSlots.find((item) => item.startTime === '14:00')._id, therapyType: 'Clinic visit' });
    assert.equal(overlapBooking.status, 409);
    const movedDateObject = new Date(receptionDate); movedDateObject.setUTCDate(movedDateObject.getUTCDate() + 1);
    const receptionistMovedDate = movedDateObject.toISOString().slice(0, 10);
    assert.equal((await request('/therapy/create', doctor, 'POST', { date: receptionistMovedDate, times: ['15:00'] })).status, 200);
    const replacementSlot = await TherapySession.findOne({ practitioner: doctor._id, patient: null, date: { $gte: new Date(`${receptionistMovedDate}T00:00:00.000Z`) }, startTime: '15:00', sessionName: 'General Slot' }).lean();
    deskBooking = await request(`/api/receptionist/appointments/${deskAppointmentId}`, receptionist, 'PATCH', { action: 'reschedule', newSlotId: replacementSlot._id });
    assert.equal(deskBooking.status, 200);
    assert.equal(deskBooking.body.appointment.scheduleHistory.length, 1);
    deskBooking = await request(`/api/receptionist/appointments/${deskAppointmentId}`, receptionist, 'PATCH', { action: 'check-in' });
    assert.equal(deskBooking.status, 200);
    assert.ok((await TherapySession.findById(deskAppointmentId).lean()).checkedInAt);
    const secondDeskBooking = await request('/api/receptionist/appointments', receptionist, 'POST', { patientId: receptionPatient._id, slotId: receptionSlots.find((item) => item.startTime === '16:00')._id, therapyType: 'Clinic visit' });
    assert.equal(secondDeskBooking.status, 201);
    const deskCancellation = await request(`/api/receptionist/appointments/${secondDeskBooking.body.appointment._id}`, receptionist, 'PATCH', { action: 'cancel' });
    assert.equal(deskCancellation.status, 200);
    assert.equal((await TherapySession.findById(secondDeskBooking.body.appointment._id).lean()).status, 'cancelled');
    assert.equal((await request(`/api/receptionist/appointments?date=${receptionistMovedDate}`, receptionist)).body.appointments.length, 1);
    assert.ok([400, 409].includes((await request(`/therapy/book/${restrictedSlot._id}`, patient, 'POST', {})).status), 'unavailable clinic slots must be rejected');
    response = await request(`/sessions/${slotC._id}`, patient, 'PUT', { startTime: '08:00' });
    assert.ok([400, 409].includes(response.status), 'rescheduling outside clinic or practitioner hours must be rejected');
    assert.equal((await request('/therapy/create', doctor, 'POST', { date: slotDate, times: ['08:00'] })).status, 400);
    assert.equal((await request('/therapy/create', doctor, 'POST', { date: slotDate, times: ['10:00'] })).status, 200);
    const clinicSlot = await TherapySession.findOne({ practitioner: doctor._id, patient: null, date: { $gte: new Date(slotDate), $lt: new Date(new Date(slotDate).setDate(new Date(slotDate).getDate() + 1)) } });
    assert.equal(clinicSlot.durationMins, 45);
    response = await request(`/sessions/${clinicSlot._id}`, admin, 'PUT', { status: 'cancelled', cancelledReason: 'Test-only administrative cancellation' });
    assert.equal(response.status, 200);
    assert.equal((await TherapySession.findById(clinicSlot._id).lean()).cancelledReason, 'Test-only administrative cancellation');
    response = await request('/api/admin/operations/activity', admin);
    assert.equal(response.status, 200);
    assert.ok(response.body.events.some((item) => item.type === 'clinic-settings-updated'));
    assert.ok(response.body.events.some((item) => item.type === 'appointment-status'));

    console.log(JSON.stringify({ isolatedDatabase: databaseName, transactionSupport: true, assessmentAndPlanWorkflow: 'passed', sessionPersistenceAndIdempotency: 'passed', roleAndOwnershipChecks: 'passed', concurrentOverlappingBookings: 'one accepted, one rejected' }));
  } finally {
    await Promise.all([
      ...(patient ? [User.deleteOne({ _id: patient._id })] : []),
      ...(otherPatient ? [User.deleteOne({ _id: otherPatient._id })] : []),
      ...(doctor ? [User.deleteOne({ _id: doctor._id })] : []),
      ...(otherDoctor ? [User.deleteOne({ _id: otherDoctor._id })] : []),
      ...(secondDoctor ? [User.deleteOne({ _id: secondDoctor._id })] : []),
      ...(admin ? [User.deleteOne({ _id: admin._id })] : []),
      ...(receptionist ? [User.deleteOne({ _id: receptionist._id })] : []),
      ...(staffPractitioner ? [User.deleteOne({ _id: staffPractitioner._id })] : []),
      ...(reminderSession ? [TherapySession.deleteOne({ _id: reminderSession._id })] : []),
      ...(assessment ? [DoctorAssessment.deleteOne({ _id: assessment._id })] : []),
      ...(plan ? [TreatmentPlan.deleteOne({ _id: plan._id })] : []),
      ...(adminPlan ? [TreatmentPlan.deleteOne({ _id: adminPlan._id })] : []),
      ...(plan ? [TherapySession.deleteMany({ treatmentPlan: plan._id })] : []),
      ...(slotA ? [TherapySession.deleteOne({ _id: slotA._id })] : []),
      ...(slotB ? [TherapySession.deleteOne({ _id: slotB._id })] : []),
      ...(slotC ? [TherapySession.deleteOne({ _id: slotC._id })] : []),
      ...(slotD ? [TherapySession.deleteOne({ _id: slotD._id })] : []),
      ...(slotE ? [TherapySession.deleteOne({ _id: slotE._id })] : []),
      ...(slotF ? [TherapySession.deleteOne({ _id: slotF._id })] : []),
      ...(slotG ? [TherapySession.deleteOne({ _id: slotG._id })] : []),
    ]);
    await ScheduleLock.deleteMany({ lockKey: { $regex: String(patient?._id || 'no-patient') } });
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
};

main().catch((error) => { console.error('Workflow integration test failed:', error.stack || error.message); process.exitCode = 1; });
