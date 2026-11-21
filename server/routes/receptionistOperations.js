const express = require('express');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const User = require('../models/User');
const TherapySession = require('../models/TherapySession');
const TreatmentPlan = require('../models/TreatmentPlan');
const { overlaps } = require('../utils/sessionTime');
const { acquireScheduleLocks } = require('../utils/scheduleLocks');
const { validateClinicSlot } = require('../utils/clinicScheduling');
const { notifyUsers, notifyReceptionists } = require('../utils/notifications');
const Notification = require('../models/Notification');
const { isValidUserPassword } = require('../utils/passwordPolicy');
const { practitionerCoversTime, practitionerHasSkills, validScheduleDate } = require('../utils/receptionTherapyScheduling');

const router = express.Router();
router.use(auth, (req, res, next) => req.user.userType === 'receptionist' ? next() : res.status(403).json({ message: 'Receptionist access required' }));

router.get('/patients', async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length > 120) return res.status(400).json({ message: 'Search query is too long' });
    const filter = { userType: 'patient' };
    if (q) { const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); filter.$or = [{ name: new RegExp(escaped, 'i') }, { email: new RegExp(escaped, 'i') }, { phone: new RegExp(escaped, 'i') }]; }
    const patients = await User.find(filter).select('name email phone personalDetails address assignedPractitioner accountStatus createdAt').populate('assignedPractitioner', 'name email').sort({ name: 1 }).limit(100).lean();
    const patientIds = patients.map((patient) => patient._id); const now = new Date();
    const sessions = patientIds.length ? await TherapySession.find({ patient: { $in: patientIds } }).select('patient date startTime sessionName therapyType status').sort({ date: 1, startTime: 1 }).lean() : [];
    const annotated = patients.map((patient) => {
      const history = sessions.filter((item) => String(item.patient) === String(patient._id));
      return { ...patient, lastAppointment: history.filter((item) => new Date(item.date) < now).sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null, upcomingAppointment: history.find((item) => new Date(item.date) >= now && ['scheduled', 'confirmed'].includes(item.status)) || null };
    });
    res.json({ patients: annotated });
  } catch (_error) { res.status(500).json({ message: 'Unable to search patients' }); }
});

router.get('/dashboard', async (_req, res) => {
  try {
    const now = new Date(); const todayStart = new Date(now); todayStart.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(todayStart); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const [totalRegisteredPatients, newPatientsToday, todaysAppointments, upcomingAppointments, unreadNotifications] = await Promise.all([
      User.countDocuments({ userType: 'patient' }),
      User.countDocuments({ userType: 'patient', createdAt: { $gte: todayStart, $lt: tomorrow } }),
      TherapySession.find({ patient: { $ne: null }, date: { $gte: todayStart, $lt: tomorrow } }).select('patient practitioner therapyType sessionName date startTime durationMins status checkedInAt').populate('patient', 'name email phone').populate('practitioner', 'name email').sort({ startTime: 1 }).limit(500).lean(),
      TherapySession.find({ patient: { $ne: null }, date: { $gte: tomorrow }, status: { $in: ['scheduled', 'confirmed'] } }).select('patient practitioner therapyType sessionName date startTime durationMins status').populate('patient', 'name').populate('practitioner', 'name').sort({ date: 1, startTime: 1 }).limit(30).lean(),
      Notification.countDocuments({ user: _req.user._id, read: false }),
    ]);
    res.json({ totalRegisteredPatients, newPatientsToday, unreadNotifications, todaysAppointments, upcomingAppointments, metrics: {
      todaysAppointments: todaysAppointments.filter((item) => item.status !== 'cancelled').length,
      upcomingAppointments: upcomingAppointments.length,
      checkedInPatients: todaysAppointments.filter((item) => Boolean(item.checkedInAt)).length,
      waitingPatients: todaysAppointments.filter((item) => item.checkedInAt && ['scheduled', 'confirmed'].includes(item.status)).length,
      completedConsultations: todaysAppointments.filter((item) => item.status === 'completed' && !item.treatmentPlan).length,
      cancelledAppointments: todaysAppointments.filter((item) => item.status === 'cancelled').length,
    } });
  } catch (error) { console.error('Reception dashboard failed:', error.name); res.status(500).json({ message: 'Unable to load reception dashboard' }); }
});

router.post('/patients', async (req, res) => {
  try {
    const { name, email, phone = '', password, gender = '', dateOfBirth, address = {} } = req.body;
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 120) return res.status(400).json({ message: 'Name must be between 2 and 120 characters' });
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.length > 254) return res.status(400).json({ message: 'Enter a valid email address' });
    if (!isValidUserPassword(password)) return res.status(400).json({ message: 'Set an initial password between 6 and 128 characters with the patient' });
    if (phone !== undefined && (typeof phone !== 'string' || phone.length > 40)) return res.status(400).json({ message: 'Invalid phone number' });
    if (gender && !['male', 'female', 'other', 'prefer_not_to_say'].includes(gender)) return res.status(400).json({ message: 'Invalid gender' });
    if (dateOfBirth && (Number.isNaN(new Date(dateOfBirth).getTime()) || new Date(dateOfBirth) > new Date())) return res.status(400).json({ message: 'Invalid date of birth' });
    const normalizedEmail = email.trim().toLowerCase();
    if (await User.exists({ email: normalizedEmail })) return res.status(409).json({ message: 'An account already exists for this email' });
    const patient = await User.create({ name: name.trim(), email: normalizedEmail, phone: phone.trim(), userType: 'patient', accountStatus: 'active', password: await bcrypt.hash(password, 12), ...(gender || dateOfBirth ? { personalDetails: { ...(gender ? { gender } : {}), ...(dateOfBirth ? { dateOfBirth: new Date(dateOfBirth) } : {}) } } : {}), address: { street: String(address.street || '').slice(0, 200), city: String(address.city || '').slice(0, 100), state: String(address.state || '').slice(0, 100), pincode: String(address.pincode || '').slice(0, 20), country: String(address.country || 'India').slice(0, 80) } });
    await notifyReceptionists('admin-update', 'Patient registered', `A new patient account was registered: ${patient.name}.`, { dedupeKey: `reception-patient-registered:${patient._id}` });
    res.status(201).json({ patient: { _id: patient._id, name: patient.name, email: patient.email, phone: patient.phone, userType: patient.userType } });
  } catch (_error) { res.status(500).json({ message: 'Patient account could not be created' }); }
});

router.patch('/patients/:patientId/contact', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.patientId)) return res.status(400).json({ message: 'Invalid patient id' });
    const { name, phone, gender, dateOfBirth, address } = req.body;
    const changes = {};
    if (name !== undefined) { if (typeof name !== 'string' || name.trim().length < 2 || name.length > 120) return res.status(400).json({ message: 'Invalid patient name' }); changes.name = name.trim(); }
    if (phone !== undefined) { if (typeof phone !== 'string' || phone.length > 40) return res.status(400).json({ message: 'Invalid phone number' }); changes.phone = phone.trim(); }
    if (gender !== undefined) { if (!['male', 'female', 'other', 'prefer_not_to_say', ''].includes(gender)) return res.status(400).json({ message: 'Invalid gender' }); changes['personalDetails.gender'] = gender; }
    if (dateOfBirth !== undefined) { if (dateOfBirth && (Number.isNaN(new Date(dateOfBirth).getTime()) || new Date(dateOfBirth) > new Date())) return res.status(400).json({ message: 'Invalid date of birth' }); changes['personalDetails.dateOfBirth'] = dateOfBirth || null; }
    if (address !== undefined) { if (!address || typeof address !== 'object' || Array.isArray(address)) return res.status(400).json({ message: 'Invalid address' }); for (const key of ['street', 'city', 'state', 'pincode', 'country']) { if (address[key] !== undefined && (typeof address[key] !== 'string' || address[key].length > 200)) return res.status(400).json({ message: `Invalid address ${key}` }); changes[`address.${key}`] = address[key]; } }
    const patient = await User.findOneAndUpdate({ _id: req.params.patientId, userType: 'patient' }, { $set: changes }, { new: true, runValidators: true }).select('name email phone personalDetails address');
    if (!patient) return res.status(404).json({ message: 'Patient not found' });
    res.json({ patient });
  } catch (_error) { res.status(400).json({ message: 'Patient contact details could not be updated' }); }
});

router.get('/practitioners', async (_req, res) => {
  try {
    const practitioners = await User.find({ userType: 'practitioner', accountStatus: { $ne: 'suspended' }, professionalStatus: { $ne: 'inactive' }, verificationStatus: 'verified' }).select('name email phone practiceAreas availabilitySchedule professionalStatus verificationStatus').sort({ name: 1 }).lean();
    res.json({ practitioners });
  } catch (_error) { res.status(500).json({ message: 'Unable to load practitioner availability' }); }
});

// Receptionists may view approved therapy instructions needed to schedule care.
// Assessment notes and other restricted clinical history are intentionally omitted.
router.get('/patients/:patientId/approved-treatment-plans', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.patientId)) return res.status(400).json({ message: 'Invalid patient id' });
    const patient = await User.findOne({ _id: req.params.patientId, userType: 'patient', accountStatus: { $ne: 'suspended' } }).select('_id');
    if (!patient) return res.status(404).json({ message: 'Patient not found or inactive' });
    const plans = await TreatmentPlan.find({ patient: patient._id, status: 'approved' })
      .select('title startDate therapies status generatedAt')
      .sort({ createdAt: -1 }).lean();
    const planIds = plans.map((plan) => plan._id);
    const sessions = planIds.length ? await TherapySession.find({ treatmentPlan: { $in: planIds } }).select('treatmentPlan planSessionKey').lean() : [];
    const enrichedPlans = plans.map((plan) => ({ ...plan, therapies: plan.therapies.map((therapy, therapyIndex) => {
      const scheduledOccurrences = new Set();
      for (const session of sessions) {
        if (String(session.treatmentPlan) !== String(plan._id) || typeof session.planSessionKey !== 'string') continue;
        const generated = session.planSessionKey.match(/^(\d+):(\d+)$/);
        if (generated && Number(generated[1]) === therapyIndex) scheduledOccurrences.add(Number(generated[2]));
        const manual = session.planSessionKey.match(new RegExp(`^reception:${String(therapy._id)}:(\\d+)$`));
        if (manual) scheduledOccurrences.add(Number(manual[1]));
      }
      return { ...therapy, scheduledOccurrences: [...scheduledOccurrences] };
    }) }));
    res.json({ plans: enrichedPlans });
  } catch (_error) { res.status(500).json({ message: 'Unable to load approved treatment plans' }); }
});

// Return only published free slots that fit the selected approved-plan therapy.
router.get('/therapy-availability', async (req, res) => {
  try {
    const { patientId, planId, therapyId, occurrence, date } = req.query;
    if (![patientId, planId, therapyId].every((value) => mongoose.isValidObjectId(value)) || !validScheduleDate(date) || !/^\d+$/.test(String(occurrence))) return res.status(400).json({ message: 'Select a patient, approved plan, therapy occurrence and valid date' });
    const [patient, plan] = await Promise.all([
      User.findOne({ _id: patientId, userType: 'patient', accountStatus: { $ne: 'suspended' } }).select('_id'),
      TreatmentPlan.findOne({ _id: planId, patient: patientId, status: 'approved' }).select('therapies').lean(),
    ]);
    if (!patient) return res.status(404).json({ message: 'Patient not found or inactive' });
    if (!plan) return res.status(404).json({ message: 'Approved treatment plan not found for this patient' });
    const therapy = plan.therapies.find((item) => String(item._id) === String(therapyId));
    if (!therapy) return res.status(400).json({ message: 'Therapy is not part of this approved plan' });
    const occurrenceIndex = Number(occurrence);
    if (!Number.isInteger(occurrenceIndex) || occurrenceIndex < 0 || occurrenceIndex >= therapy.occurrences) return res.status(400).json({ message: 'Invalid occurrence for this prescribed therapy' });
    const therapyIndex = plan.therapies.findIndex((item) => String(item._id) === String(therapyId));
    const occurrenceKeys = [`${therapyIndex}:${occurrenceIndex}`, `reception:${therapy._id}:${occurrenceIndex}`];
    if (await TherapySession.exists({ treatmentPlan: plan._id, planSessionKey: { $in: occurrenceKeys } })) return res.json({ practitioners: [] });
    const durationMins = Number(therapy.catalogSnapshot?.durationMins || therapy.durationMins);
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(dayStart); dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
    if (dayStart < new Date(new Date().setUTCHours(0, 0, 0, 0))) return res.json({ practitioners: [] });
    const slots = await TherapySession.find({
      patient: null, isBooked: false, status: 'scheduled', treatmentPlan: null,
      sessionName: { $in: ['General Slot', 'Consultation Slot'] }, date: { $gte: dayStart, $lt: dayEnd },
    }).populate('practitioner', 'name profileImageUrl practiceAreas qualifications availabilitySchedule professionalStatus verificationStatus accountStatus').sort({ startTime: 1 }).lean();
    const practitionerIds = [...new Set(slots.filter((slot) => slot.practitioner?._id).map((slot) => String(slot.practitioner._id)))];
    const occupied = practitionerIds.length ? await TherapySession.find({
      date: { $gte: dayStart, $lt: dayEnd }, status: { $ne: 'cancelled' },
      $or: [{ patient: patient._id }, { practitioner: { $in: practitionerIds } }],
    }).select('patient practitioner startTime durationMins').lean() : [];
    const eligible = new Map();
    for (const slot of slots) {
      const practitioner = slot.practitioner;
      if (!practitioner || practitioner.accountStatus === 'suspended' || practitioner.professionalStatus === 'inactive' || practitioner.verificationStatus !== 'verified') continue;
      if (!practitionerHasSkills(practitioner, therapy.catalogSnapshot?.requiredSkills || [])) continue;
      if (Number(slot.durationMins || 60) < durationMins || !practitionerCoversTime(practitioner, slot.date, slot.startTime, durationMins)) continue;
      const clinicError = await validateClinicSlot({ date: slot.date, startTime: slot.startTime, durationMins });
      if (clinicError) continue;
      const hasConflict = occupied.some((item) => String(item._id) !== String(slot._id) &&
        (String(item.patient || '') === String(patient._id) || String(item.practitioner || '') === String(practitioner._id)) &&
        overlaps(slot.startTime, durationMins, item.startTime, item.durationMins || 60));
      if (hasConflict) continue;
      const key = String(practitioner._id);
      if (!eligible.has(key)) eligible.set(key, { _id: practitioner._id, name: practitioner.name, profileImageUrl: practitioner.profileImageUrl, practiceAreas: practitioner.practiceAreas || [], slots: [] });
      eligible.get(key).slots.push({ _id: slot._id, date: slot.date, startTime: slot.startTime, durationMins });
    }
    res.json({ practitioners: [...eligible.values()] });
  } catch (_error) { res.status(500).json({ message: 'Unable to load therapy availability' }); }
});

router.post('/therapy-sessions', async (req, res) => {
  let dbSession;
  try {
    const { patientId, planId, therapyId, occurrence, slotId } = req.body;
    if (![patientId, planId, therapyId, slotId].every((value) => mongoose.isValidObjectId(value)) || !Number.isInteger(occurrence) || occurrence < 0) return res.status(400).json({ message: 'Select a patient, approved therapy occurrence and available appointment slot' });
    dbSession = await mongoose.startSession();
    let created;
    await dbSession.withTransaction(async () => {
      const [patient, plan] = await Promise.all([
        User.findOne({ _id: patientId, userType: 'patient', accountStatus: { $ne: 'suspended' } }).select('_id').session(dbSession),
        TreatmentPlan.findOne({ _id: planId, patient: patientId, status: 'approved' }).session(dbSession),
      ]);
      if (!patient) { const error = new Error('Patient not found or inactive'); error.status = 404; throw error; }
      if (!plan) { const error = new Error('Approved treatment plan not found for this patient'); error.status = 404; throw error; }
      const therapyIndex = plan.therapies.findIndex((item) => String(item._id) === String(therapyId));
      if (therapyIndex < 0) { const error = new Error('Therapy is not part of this approved plan'); error.status = 400; throw error; }
      const therapy = plan.therapies[therapyIndex];
      if (occurrence >= therapy.occurrences) { const error = new Error('Invalid occurrence for this prescribed therapy'); error.status = 400; throw error; }
      const slot = await TherapySession.findOne({ _id: slotId, patient: null, isBooked: false, status: 'scheduled', treatmentPlan: null, sessionName: { $in: ['General Slot', 'Consultation Slot'] } }).session(dbSession);
      if (!slot) { const error = new Error('This published appointment slot is no longer available'); error.status = 409; throw error; }
      const durationMins = Number(therapy.catalogSnapshot?.durationMins || therapy.durationMins);
      if (Number(slot.durationMins || 60) < durationMins) { const error = new Error('The available slot is shorter than the prescribed therapy duration'); error.status = 409; throw error; }
      const practitioner = await User.findOne({ _id: slot.practitioner, userType: 'practitioner', accountStatus: { $ne: 'suspended' }, professionalStatus: { $ne: 'inactive' }, verificationStatus: 'verified' }).select('name practiceAreas qualifications availabilitySchedule').session(dbSession);
      if (!practitioner) { const error = new Error('Vaidya is no longer active or verified'); error.status = 409; throw error; }
      if (!practitionerHasSkills(practitioner, therapy.catalogSnapshot?.requiredSkills || [])) { const error = new Error('Vaidya does not meet the prescribed therapy skill requirements'); error.status = 409; throw error; }
      if (!practitionerCoversTime(practitioner, slot.date, slot.startTime, durationMins)) { const error = new Error('Vaidya is not available for the therapy duration at this time'); error.status = 409; throw error; }
      const clinicError = await validateClinicSlot({ date: slot.date, startTime: slot.startTime, durationMins }, dbSession);
      if (clinicError) { const error = new Error(clinicError); error.status = 400; throw error; }
      await acquireScheduleLocks(dbSession, { date: slot.date, patientId: patient._id, practitionerId: practitioner._id });
      const dayEnd = new Date(slot.date); dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
      const existing = await TherapySession.find({
        _id: { $ne: slot._id }, date: { $gte: new Date(slot.date), $lt: dayEnd }, status: { $ne: 'cancelled' },
        $or: [{ patient: patient._id }, { practitioner: practitioner._id }],
      }).select('startTime durationMins').session(dbSession);
      if (existing.some((item) => overlaps(slot.startTime, durationMins, item.startTime, item.durationMins || 60))) { const error = new Error('Patient or Vaidya already has an overlapping session'); error.status = 409; throw error; }
      const planSessionKeys = [`${therapyIndex}:${occurrence}`, `reception:${therapy._id}:${occurrence}`];
      if (await TherapySession.exists({ treatmentPlan: plan._id, planSessionKey: { $in: planSessionKeys } }).session(dbSession)) { const error = new Error('This prescribed therapy occurrence has already been scheduled'); error.status = 409; throw error; }
      const reservedSlot = await TherapySession.findOneAndUpdate(
        { _id: slot._id, patient: null, isBooked: false, status: 'scheduled' },
        { $set: { status: 'cancelled', cancelledReason: 'Reserved for an approved treatment-plan therapy session' }, $push: { statusHistory: { status: 'cancelled', changedBy: req.user._id, reason: 'Slot consumed by therapy assignment' } } },
        { new: true, session: dbSession },
      );
      if (!reservedSlot) { const error = new Error('This appointment slot was just booked by someone else'); error.status = 409; throw error; }
      [created] = await TherapySession.create([{
        patient: patient._id, practitioner: practitioner._id, treatmentPlan: plan._id,
        catalogTherapy: therapy.catalogTherapy || null, therapySnapshot: therapy.catalogSnapshot || undefined,
        planSessionKey: `${therapyIndex}:${occurrence}`, therapyType: therapy.therapyType, phase: therapy.phase, sessionName: therapy.sessionName,
        date: slot.date, startTime: slot.startTime, durationMins, notes: therapy.instructions || '',
        status: 'scheduled', isBooked: true,
        statusHistory: [{ status: 'scheduled', changedBy: req.user._id, reason: 'Scheduled by reception from an approved treatment plan' }],
      }], { session: dbSession });
    });
    const result = await TherapySession.findById(created._id).populate('patient', 'name email phone').populate('practitioner', 'name email profileImageUrl').populate('treatmentPlan', 'title status startDate objectives precautions therapies').lean();
    await notifyUsers([created.patient, created.practitioner], 'appointment-booked', 'Therapy session assigned', 'A therapy session from your approved treatment plan has been scheduled.', { dedupeKey: `appointment-booked:${created._id}` }).catch((error) => console.error('Therapy assignment notification failed:', error.name));
    res.status(201).json({ session: result });
  } catch (error) { res.status(error.status || (error.code === 11000 ? 409 : 500)).json({ message: error.status || error.code === 11000 ? error.message : 'Therapy session could not be scheduled' }); }
  finally { if (dbSession) await dbSession.endSession(); }
});

router.get('/appointments', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00.000Z`).getTime())) return res.status(400).json({ message: 'Date must use YYYY-MM-DD' });
    const start = new Date(`${date}T00:00:00.000Z`); const end = new Date(start); end.setUTCDate(end.getUTCDate() + 1);
    const appointments = await TherapySession.find({ patient: { $ne: null }, date: { $gte: start, $lt: end } }).select('patient practitioner therapyType phase sessionName date startTime durationMins status checkedInAt checkedInBy scheduleHistory statusHistory cancelledReason isBooked').populate('patient', 'name email phone').populate('practitioner', 'name email practiceAreas').sort({ startTime: 1 }).limit(500).lean();
    res.json({ appointments });
  } catch (_error) { res.status(500).json({ message: 'Unable to load daily appointments' }); }
});

router.post('/appointments', async (req, res) => {
  const dbSession = await mongoose.startSession();
  try {
    const { patientId, slotId, therapyType = 'Consultation' } = req.body;
    if (!mongoose.isValidObjectId(patientId) || !mongoose.isValidObjectId(slotId)) return res.status(400).json({ message: 'Select a patient and a published appointment slot' });
    if (typeof therapyType !== 'string' || therapyType.trim().length < 2 || therapyType.length > 120) return res.status(400).json({ message: 'Invalid appointment type' });
    let created;
    await dbSession.withTransaction(async () => {
      const [patient, slot] = await Promise.all([
        User.findOne({ _id: patientId, userType: 'patient', accountStatus: { $ne: 'suspended' } }).session(dbSession),
        TherapySession.findOne({ _id: slotId, patient: null, isBooked: false, status: 'scheduled', treatmentPlan: null, sessionName: { $in: ['General Slot', 'Consultation Slot'] } }).session(dbSession),
      ]);
      if (!patient) { const error = new Error('Patient not found or inactive'); error.status = 404; throw error; }
      if (!slot) { const error = new Error('This published slot is no longer available'); error.status = 409; throw error; }
      const practitioner = await User.findOne({ _id: slot.practitioner, userType: 'practitioner', accountStatus: { $ne: 'suspended' }, professionalStatus: { $ne: 'inactive' }, verificationStatus: 'verified' }).select('availabilitySchedule').session(dbSession);
      if (!practitioner) { const error = new Error('Practitioner not found or inactive'); error.status = 404; throw error; }
      const appointmentDate = slot.date; const startTime = slot.startTime; const durationMins = slot.durationMins || 60;
      const clinicError = await validateClinicSlot({ date: appointmentDate, startTime, durationMins }, dbSession);
      if (clinicError) { const error = new Error(clinicError); error.status = 400; throw error; }
      if (practitioner.availabilitySchedule?.length) {
        const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][appointmentDate.getUTCDay()];
        const schedule = practitioner.availabilitySchedule.find((item) => item.dayOfWeek === dayName && item.isAvailable);
        const startMins = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3));
        const [endHours, endMinutes] = (schedule?.endTime || '00:00').split(':').map(Number);
        if (!schedule || startTime < schedule.startTime || startMins + durationMins > endHours * 60 + endMinutes) { const error = new Error('Practitioner is not available for this time'); error.status = 409; throw error; }
      }
      await acquireScheduleLocks(dbSession, { date: appointmentDate, patientId: patient._id, practitionerId: slot.practitioner });
      const dayEnd = new Date(appointmentDate); dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
      const existing = await TherapySession.find({ _id: { $ne: slot._id }, date: { $gte: appointmentDate, $lt: dayEnd }, status: { $ne: 'cancelled' }, patient: { $ne: null }, $or: [{ patient: patient._id }, { practitioner: slot.practitioner }] }).select('startTime durationMins').session(dbSession);
      if (existing.some((item) => overlaps(startTime, durationMins, item.startTime, item.durationMins || 60))) { const error = new Error('Patient or practitioner already has an overlapping appointment'); error.status = 409; throw error; }
      created = await TherapySession.findOneAndUpdate({ _id: slot._id, patient: null, isBooked: false, status: 'scheduled' }, { $set: { patient: patient._id, isBooked: true, therapyType: therapyType.trim(), phase: 'General', sessionName: 'Clinic Appointment' }, $push: { statusHistory: { status: 'scheduled', changedBy: req.user._id, reason: 'Booked by reception' } } }, { new: true, runValidators: true, session: dbSession });
      if (!created) { const error = new Error('This published slot was booked by someone else'); error.status = 409; throw error; }
    });
    await notifyUsers([created.patient, created.practitioner], 'appointment-booked', 'Appointment booked', 'A clinic appointment has been scheduled.', { dedupeKey: `appointment-booked:${created._id}` });
    await notifyReceptionists('appointment-booked', 'Appointment booked at reception', 'A receptionist booked a patient into a published Vaidya slot.', { dedupeKey: `reception-appointment-booked:${created._id}` });
    res.status(201).json({ appointment: created });
  } catch (error) { res.status(error.status || 500).json({ message: error.status ? error.message : 'Appointment could not be booked' }); }
  finally { await dbSession.endSession(); }
});

router.patch('/appointments/:appointmentId', async (req, res) => {
  let dbSession;
  try {
    if (!mongoose.isValidObjectId(req.params.appointmentId)) return res.status(400).json({ message: 'Invalid appointment id' });
    const { action } = req.body;
    const appointment = await TherapySession.findById(req.params.appointmentId);
    if (!appointment) return res.status(404).json({ message: 'Appointment not found' });
    if (action === 'check-in') {
      if (!['scheduled', 'confirmed'].includes(appointment.status)) return res.status(409).json({ message: 'Only scheduled appointments can be checked in' });
      if (appointment.checkedInAt) return res.status(409).json({ message: 'Patient has already been checked in' });
      appointment.checkedInAt = new Date(); appointment.checkedInBy = req.user._id; await appointment.save();
      await notifyUsers([appointment.practitioner], 'appointment-confirmed', 'Patient checked in', 'A patient has checked in for an appointment.', { dedupeKey: `appointment-checkin:${appointment._id}` });
      return res.json({ appointment });
    }
    if (action === 'cancel') {
      if (!['scheduled', 'confirmed'].includes(appointment.status)) return res.status(409).json({ message: 'Only scheduled appointments can be cancelled' });
      appointment.status = 'cancelled'; appointment.statusHistory.push({ status: 'cancelled', changedBy: req.user._id, reason: 'Cancelled by reception' }); await appointment.save();
      await notifyUsers([appointment.patient, appointment.practitioner], 'appointment-cancelled', 'Appointment cancelled', 'A clinic appointment has been cancelled.', { dedupeKey: `appointment-cancelled:${appointment._id}` });
      await notifyReceptionists('appointment-cancelled', 'Appointment cancelled at reception', 'A scheduled appointment was cancelled.', { dedupeKey: `reception-appointment-cancelled:${appointment._id}` });
      return res.json({ appointment });
    }
    if (action === 'reschedule') {
      const { newSlotId } = req.body;
      if (!mongoose.isValidObjectId(newSlotId)) return res.status(400).json({ message: 'Choose a published replacement slot' });
      if (!['scheduled', 'confirmed'].includes(appointment.status)) return res.status(409).json({ message: 'Only scheduled appointments can be rescheduled' });
      if (appointment.checkedInAt) return res.status(409).json({ message: 'A checked-in appointment cannot be rescheduled' });
      dbSession = await mongoose.startSession();
      let updated;
      await dbSession.withTransaction(async () => {
        const current = await TherapySession.findById(appointment._id).session(dbSession);
        if (!current || !['scheduled', 'confirmed'].includes(current.status)) { const error = new Error('Appointment is no longer available to reschedule'); error.status = 409; throw error; }
        const replacement = await TherapySession.findOne({ _id: newSlotId, practitioner: current.practitioner, patient: null, isBooked: false, status: 'scheduled', treatmentPlan: null, sessionName: { $in: ['General Slot', 'Consultation Slot'] } }).session(dbSession);
        if (!replacement) { const error = new Error('The selected published slot is no longer available'); error.status = 409; throw error; }
        const nextDate = replacement.date; const startTime = replacement.startTime; const durationMins = current.durationMins || replacement.durationMins || 60;
        if ((replacement.durationMins || 60) < durationMins) { const error = new Error('The replacement slot is shorter than this session duration'); error.status = 409; throw error; }
        const practitioner = await User.findOne({ _id: current.practitioner, userType: 'practitioner', accountStatus: { $ne: 'suspended' }, professionalStatus: { $ne: 'inactive' }, verificationStatus: 'verified' }).select('availabilitySchedule').session(dbSession);
        if (!practitioner || !practitionerCoversTime(practitioner, nextDate, startTime, durationMins)) { const error = new Error('Vaidya is unavailable for the replacement time'); error.status = 409; throw error; }
        const clinicError = await validateClinicSlot({ date: nextDate, startTime, durationMins }, dbSession);
        if (clinicError) { const error = new Error(clinicError); error.status = 400; throw error; }
        await acquireScheduleLocks(dbSession, { date: nextDate, patientId: current.patient, practitionerId: current.practitioner });
        const dayEnd = new Date(nextDate); dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
        const existing = await TherapySession.find({ _id: { $nin: [current._id, replacement._id] }, date: { $gte: nextDate, $lt: dayEnd }, status: { $ne: 'cancelled' }, patient: { $ne: null }, $or: [{ patient: current.patient }, { practitioner: current.practitioner }] }).select('startTime durationMins').session(dbSession);
        if (existing.some((item) => overlaps(startTime, durationMins, item.startTime, item.durationMins || 60))) { const error = new Error('Patient or practitioner already has an overlapping appointment'); error.status = 409; throw error; }
        replacement.status = 'cancelled'; replacement.cancelledReason = `Reserved as replacement for appointment ${current._id}`; replacement.statusHistory.push({ status: 'cancelled', changedBy: req.user._id, reason: 'Replacement slot consumed during rescheduling' }); await replacement.save({ session: dbSession });
        current.scheduleHistory.push({ from: { date: current.date, startTime: current.startTime }, to: { date: nextDate, startTime }, changedBy: req.user._id });
        current.date = nextDate; current.startTime = startTime; current.durationMins = durationMins; updated = await current.save({ session: dbSession });
      });
      await notifyUsers([updated.patient, updated.practitioner], 'appointment-rescheduled', 'Appointment rescheduled', 'A clinic appointment has been rescheduled.', { dedupeKey: `appointment-rescheduled:${updated._id}:${updated.updatedAt.getTime()}` });
      await notifyReceptionists('appointment-rescheduled', 'Appointment rescheduled at reception', 'A clinic appointment time was changed.', { dedupeKey: `reception-appointment-rescheduled:${updated._id}:${updated.updatedAt.getTime()}` });
      return res.json({ appointment: updated });
    }
    return res.status(400).json({ message: 'Unsupported appointment action' });
  } catch (error) { res.status(error.status || 500).json({ message: error.status ? error.message : 'Appointment could not be updated' }); }
  finally { if (dbSession) await dbSession.endSession(); }
});

module.exports = router;
