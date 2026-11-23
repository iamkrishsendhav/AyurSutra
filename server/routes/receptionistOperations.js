const express = require('express');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const User = require('../models/User');
const TherapySession = require('../models/TherapySession');
const TreatmentPlan = require('../models/TreatmentPlan');
const PatientFollowUp = require('../models/PatientFollowUp');
const AppointmentWaitlist = require('../models/AppointmentWaitlist');
const { overlaps } = require('../utils/sessionTime');
const { acquireScheduleLocks } = require('../utils/scheduleLocks');
const { validateClinicSlot } = require('../utils/clinicScheduling');
const { notifyUsers, notifyReceptionists } = require('../utils/notifications');
const Notification = require('../models/Notification');
const { isValidUserPassword } = require('../utils/passwordPolicy');
const { practitionerCoversTime, practitionerHasSkills, validScheduleDate } = require('../utils/receptionTherapyScheduling');
const { getClinicDateBounds } = require('../utils/clinicDate');

const router = express.Router();
router.use(auth, (req, res, next) => req.user.userType === 'receptionist' ? next() : res.status(403).json({ message: 'Receptionist access required' }));

router.get('/patients', async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length > 120) return res.status(400).json({ message: 'Search query is too long' });
    const filter = { userType: 'patient' };
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [{ name: new RegExp(escaped, 'i') }, { email: new RegExp(escaped, 'i') }, { phone: new RegExp(escaped, 'i') }];
      if (mongoose.isValidObjectId(q)) filter.$or.push({ _id: q });
    }
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

router.get('/patients/:patientId/profile', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.patientId)) return res.status(400).json({ message: 'Invalid patient ID' });
    const patient = await User.findOne({ _id: req.params.patientId, userType: 'patient' })
      .select('name email phone personalDetails address accountStatus createdAt').lean();
    if (!patient) return res.status(404).json({ message: 'Patient not found' });
    const [appointments, approvedTreatmentPlans, followUps] = await Promise.all([
      TherapySession.find({ patient: patient._id })
        .select('practitioner therapyType sessionName phase date startTime durationMins status checkedInAt treatmentPlan createdAt updatedAt')
        .populate('practitioner', 'name email').sort({ date: -1, startTime: -1 }).limit(250).lean(),
      TreatmentPlan.find({ patient: patient._id, status: 'approved' })
        .select('title startDate therapies status createdAt updatedAt').sort({ createdAt: -1 }).limit(100).lean(),
      PatientFollowUp.find({ patient: patient._id })
        .select('practitioner dueAt status completedAt createdAt').populate('practitioner', 'name')
        .sort({ dueAt: -1 }).limit(100).lean(),
    ]);
    const timeline = [
      ...appointments.map((item) => ({ type: 'appointment', at: item.date, title: item.sessionName || item.therapyType, status: item.status, practitioner: item.practitioner?.name || '' })),
      ...approvedTreatmentPlans.map((item) => ({ type: 'treatment-plan', at: item.startDate || item.createdAt, title: item.title || 'Approved treatment plan', status: 'approved' })),
      ...followUps.map((item) => ({ type: 'follow-up', at: item.dueAt, title: 'Follow-up', status: item.status, practitioner: item.practitioner?.name || '' })),
    ].sort((left, right) => new Date(right.at) - new Date(left.at));
    res.json({ patient, appointments, approvedTreatmentPlans, followUps, timeline });
  } catch (_error) { res.status(500).json({ message: 'Unable to load patient profile' }); }
});

router.get('/dashboard', async (_req, res) => {
  try {
    const { date: clinicDate, timestampStart, timestampEnd, calendarStart, calendarEnd } = getClinicDateBounds();
    const [totalRegisteredPatients, newPatientsToday, todaysAppointments, upcomingAppointments, unreadNotifications, activeVaidyas] = await Promise.all([
      User.countDocuments({ userType: 'patient' }),
      User.countDocuments({ userType: 'patient', createdAt: { $gte: timestampStart, $lt: timestampEnd } }),
      TherapySession.find({ patient: { $ne: null }, date: { $gte: calendarStart, $lt: calendarEnd } }).select('patient practitioner treatmentPlan therapyType sessionName date startTime durationMins status checkedInAt queueCalledAt').populate('patient', 'name email phone').populate('practitioner', 'name email').sort({ startTime: 1 }).limit(500).lean(),
      TherapySession.find({ patient: { $ne: null }, date: { $gte: calendarEnd }, status: { $in: ['scheduled', 'confirmed'] } }).select('patient practitioner therapyType sessionName date startTime durationMins status').populate('patient', 'name').populate('practitioner', 'name').sort({ date: 1, startTime: 1 }).limit(30).lean(),
      Notification.countDocuments({ user: _req.user._id, read: false }),
      User.find({ userType: 'practitioner', accountStatus: { $ne: 'suspended' }, professionalStatus: { $ne: 'inactive' }, verificationStatus: 'verified' }).select('_id availabilitySchedule').lean(),
    ]);
    const timezone = process.env.CLINIC_TIMEZONE || process.env.TZ || 'Asia/Kolkata';
    const localNow = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    const localHour = Number(localNow.find((part) => part.type === 'hour')?.value || 0);
    const localMinute = Number(localNow.find((part) => part.type === 'minute')?.value || 0);
    const currentMinute = localHour * 60 + localMinute;
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long' }).format(new Date());
    const currentlyAvailableVaidyas = activeVaidyas.filter((vaidya) => {
      const schedule = (vaidya.availabilitySchedule || []).find((item) => item.dayOfWeek === weekday && item.isAvailable !== false);
      if (!schedule || currentMinute < Number(schedule.startTime?.slice(0, 2)) * 60 + Number(schedule.startTime?.slice(3, 5)) || currentMinute >= Number(schedule.endTime?.slice(0, 2)) * 60 + Number(schedule.endTime?.slice(3, 5))) return false;
      return !todaysAppointments.some((item) => String(item.practitioner?._id || item.practitioner) === String(vaidya._id) && item.status !== 'cancelled' && currentMinute >= Number(item.startTime?.slice(0, 2)) * 60 + Number(item.startTime?.slice(3, 5)) && currentMinute < Number(item.startTime?.slice(0, 2)) * 60 + Number(item.startTime?.slice(3, 5)) + Number(item.durationMins || 60));
    }).length;
    res.json({ clinicDate, totalRegisteredPatients, newPatientsToday, unreadNotifications, todaysAppointments, upcomingAppointments, metrics: {
      todaysAppointments: todaysAppointments.filter((item) => item.status !== 'cancelled').length,
      upcomingAppointments: upcomingAppointments.length,
      checkedInPatients: todaysAppointments.filter((item) => Boolean(item.checkedInAt)).length,
      waitingPatients: todaysAppointments.filter((item) => item.checkedInAt && ['scheduled', 'confirmed'].includes(item.status)).length,
      completedConsultations: todaysAppointments.filter((item) => item.status === 'completed' && !item.treatmentPlan && (/consultation/i.test(item.sessionName || '') || /consultation/i.test(item.therapyType || '') || item.sessionName === 'Clinic Appointment')).length,
      therapySessions: todaysAppointments.filter((item) => Boolean(item.treatmentPlan) && item.status !== 'cancelled').length,
      missedAppointments: todaysAppointments.filter((item) => ['scheduled', 'confirmed'].includes(item.status) && !item.checkedInAt && currentMinute >= Number(item.startTime?.slice(0, 2)) * 60 + Number(item.startTime?.slice(3, 5)) + Number(item.durationMins || 60)).length,
      currentlyAvailableVaidyas,
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
    const normalizedPhone = phone.trim();
    if (normalizedPhone && await User.exists({ userType: 'patient', phone: normalizedPhone })) return res.status(409).json({ message: 'A patient with this phone number already exists' });
    const patient = await User.create({ name: name.trim(), email: normalizedEmail, phone: normalizedPhone, userType: 'patient', accountStatus: 'active', password: await bcrypt.hash(password, 12), ...(gender || dateOfBirth ? { personalDetails: { ...(gender ? { gender } : {}), ...(dateOfBirth ? { dateOfBirth: new Date(dateOfBirth) } : {}) } } : {}), address: { street: String(address.street || '').slice(0, 200), city: String(address.city || '').slice(0, 100), state: String(address.state || '').slice(0, 100), pincode: String(address.pincode || '').slice(0, 20), country: String(address.country || 'India').slice(0, 80) } });
    await notifyReceptionists('admin-update', 'Patient registered', `A new patient account was registered: ${patient.name}.`, { dedupeKey: `reception-patient-registered:${patient._id}` }).catch((error) => console.error('Patient registration notification failed:', error.name));
    res.status(201).json({ patient: { _id: patient._id, name: patient.name, email: patient.email, phone: patient.phone, userType: patient.userType } });
  } catch (_error) { res.status(500).json({ message: 'Patient account could not be created' }); }
});

router.patch('/patients/:patientId/contact', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.patientId)) return res.status(400).json({ message: 'Invalid patient id' });
    const { name, phone, gender, dateOfBirth, address } = req.body;
    const changes = {};
    if (name !== undefined) { if (typeof name !== 'string' || name.trim().length < 2 || name.length > 120) return res.status(400).json({ message: 'Invalid patient name' }); changes.name = name.trim(); }
    if (phone !== undefined) {
      if (typeof phone !== 'string' || phone.length > 40) return res.status(400).json({ message: 'Invalid phone number' });
      const normalizedPhone = phone.trim();
      if (normalizedPhone && await User.exists({ userType: 'patient', phone: normalizedPhone, _id: { $ne: req.params.patientId } })) return res.status(409).json({ message: 'A patient with this phone number already exists' });
      changes.phone = normalizedPhone;
    }
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
    const sessions = planIds.length ? await TherapySession.find({ treatmentPlan: { $in: planIds } }).select('treatmentPlan planSessionKey status').lean() : [];
    const enrichedPlans = plans.map((plan) => ({ ...plan, therapies: plan.therapies.map((therapy, therapyIndex) => {
      const scheduledOccurrences = new Set();
      for (const session of sessions) {
        if (String(session.treatmentPlan) !== String(plan._id) || session.status === 'cancelled' || typeof session.planSessionKey !== 'string') continue;
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
    if (await TherapySession.exists({ treatmentPlan: plan._id, planSessionKey: { $in: occurrenceKeys }, status: { $ne: 'cancelled' } })) return res.json({ practitioners: [] });
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
      const existingOccurrence = await TherapySession.findOne({ treatmentPlan: plan._id, planSessionKey: { $in: planSessionKeys } }).session(dbSession);
      if (existingOccurrence && existingOccurrence.status !== 'cancelled') { const error = new Error('This prescribed therapy occurrence has already been scheduled'); error.status = 409; throw error; }
      const reservedSlot = await TherapySession.findOneAndUpdate(
        { _id: slot._id, patient: null, isBooked: false, status: 'scheduled' },
        { $set: { status: 'cancelled', cancelledReason: 'Reserved for an approved treatment-plan therapy session' }, $push: { statusHistory: { status: 'cancelled', changedBy: req.user._id, reason: 'Slot consumed by therapy assignment' } } },
        { new: true, session: dbSession },
      );
      if (!reservedSlot) { const error = new Error('This appointment slot was just booked by someone else'); error.status = 409; throw error; }
      if (existingOccurrence) {
        existingOccurrence.scheduleHistory.push({ from: { date: existingOccurrence.date, startTime: existingOccurrence.startTime }, to: { date: slot.date, startTime: slot.startTime }, changedBy: req.user._id, reason: 'Rebooked a previously cancelled approved-plan occurrence' });
        existingOccurrence.practitioner = practitioner._id; existingOccurrence.date = slot.date; existingOccurrence.startTime = slot.startTime; existingOccurrence.durationMins = durationMins;
        existingOccurrence.status = 'scheduled'; existingOccurrence.isBooked = true; existingOccurrence.cancelledReason = undefined;
        existingOccurrence.statusHistory.push({ status: 'scheduled', changedBy: req.user._id, reason: 'Rebooked by reception from the approved treatment plan' });
        created = await existingOccurrence.save({ session: dbSession });
      } else {
        [created] = await TherapySession.create([{
          patient: patient._id, practitioner: practitioner._id, treatmentPlan: plan._id,
          catalogTherapy: therapy.catalogTherapy || null, therapySnapshot: therapy.catalogSnapshot || undefined,
          planSessionKey: `${therapyIndex}:${occurrence}`, therapyType: therapy.therapyType, phase: therapy.phase, sessionName: therapy.sessionName,
          date: slot.date, startTime: slot.startTime, durationMins, notes: therapy.instructions || '',
          status: 'scheduled', isBooked: true,
          statusHistory: [{ status: 'scheduled', changedBy: req.user._id, reason: 'Scheduled by reception from an approved treatment plan' }],
        }], { session: dbSession });
      }
    });
    const result = await TherapySession.findById(created._id).populate('patient', 'name email phone').populate('practitioner', 'name email profileImageUrl').populate('treatmentPlan', 'title status startDate objectives precautions therapies').lean();
    await notifyUsers([created.patient, created.practitioner], 'appointment-booked', 'Therapy session assigned', 'A therapy session from your approved treatment plan has been scheduled.', { dedupeKey: `appointment-booked:${created._id}` }).catch((error) => console.error('Therapy assignment notification failed:', error.name));
    res.status(201).json({ session: result });
  } catch (error) { res.status(error.status || (error.code === 11000 ? 409 : 500)).json({ message: error.status || error.code === 11000 ? error.message : 'Therapy session could not be scheduled' }); }
  finally { if (dbSession) await dbSession.endSession(); }
});

router.get('/appointments', async (req, res) => {
  try {
    const fallbackDate = getClinicDateBounds().date;
    const from = req.query.from || req.query.date || fallbackDate;
    const to = req.query.to || from;
    const validDay = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime()) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
    if (!validDay(from) || !validDay(to)) return res.status(400).json({ message: 'Dates must use YYYY-MM-DD' });
    const start = new Date(`${from}T00:00:00.000Z`);
    const end = new Date(`${to}T00:00:00.000Z`); end.setUTCDate(end.getUTCDate() + 1);
    const dayCount = (end - start) / 86400000;
    if (dayCount < 1 || dayCount > 31) return res.status(400).json({ message: 'Choose a calendar range of 31 days or less' });
    const appointments = await TherapySession.find({ patient: { $ne: null }, date: { $gte: start, $lt: end } }).select('patient practitioner therapyType phase sessionName date startTime durationMins status checkedInAt checkedInBy queueCalledAt scheduleHistory statusHistory cancelledReason isBooked treatmentPlan').populate('patient', 'name email phone').populate('practitioner', 'name email practiceAreas').sort({ date: 1, startTime: 1 }).limit(1000).lean();
    res.json({ from, to, appointments });
  } catch (_error) { res.status(500).json({ message: 'Unable to load daily appointments' }); }
});

router.get('/waitlist', async (req, res) => {
  try {
    const filter = { status: 'waiting' };
    if (req.query.date !== undefined) {
      const date = req.query.date;
      if (!validScheduleDate(date)) return res.status(400).json({ message: 'Date must use YYYY-MM-DD' });
      const start = new Date(`${date}T00:00:00.000Z`); const end = new Date(start); end.setUTCDate(end.getUTCDate() + 1);
      filter.requestedDate = { $gte: start, $lt: end };
    }
    const entries = await AppointmentWaitlist.find(filter).populate('patient', 'name email phone').populate('practitioner', 'name practiceAreas').sort({ createdAt: 1 }).limit(250).lean();
    res.json({ waitlist: entries });
  } catch (_error) { res.status(500).json({ message: 'Unable to load appointment waitlist' }); }
});

router.post('/waitlist', async (req, res) => {
  try {
    const { patientId, practitionerId, date, therapyType = 'Consultation' } = req.body;
    if (!mongoose.isValidObjectId(patientId) || !mongoose.isValidObjectId(practitionerId) || !validScheduleDate(date)) return res.status(400).json({ message: 'Select a patient, Vaidya and valid requested date' });
    if (typeof therapyType !== 'string' || therapyType.trim().length < 2 || therapyType.length > 120) return res.status(400).json({ message: 'Invalid appointment type' });
    const requestedDate = new Date(`${date}T00:00:00.000Z`); const nextDate = new Date(requestedDate); nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    const [patient, practitioner] = await Promise.all([
      User.findOne({ _id: patientId, userType: 'patient', accountStatus: { $ne: 'suspended' } }).select('_id'),
      User.findOne({ _id: practitionerId, userType: 'practitioner', accountStatus: { $ne: 'suspended' }, professionalStatus: { $ne: 'inactive' }, verificationStatus: 'verified' }).select('_id'),
    ]);
    if (!patient) return res.status(404).json({ message: 'Patient not found or inactive' });
    if (!practitioner) return res.status(404).json({ message: 'Verified Vaidya not found or inactive' });
    if (await TherapySession.exists({ practitioner: practitioner._id, date: { $gte: requestedDate, $lt: nextDate }, patient: null, isBooked: false, status: 'scheduled', treatmentPlan: null, sessionName: { $in: ['General Slot', 'Consultation Slot'] } })) return res.status(409).json({ message: 'Published appointment slots are available. Book a slot instead of joining the waitlist.' });
    const entry = await AppointmentWaitlist.create({ patient: patient._id, practitioner: practitioner._id, requestedDate, therapyType: therapyType.trim(), createdBy: req.user._id });
    const populated = await AppointmentWaitlist.findById(entry._id).populate('patient', 'name email phone').populate('practitioner', 'name practiceAreas').lean();
    await notifyReceptionists('appointment-booked', 'Appointment waitlist request added', 'A patient was added to the receptionist appointment waitlist.', { dedupeKey: `appointment-waitlist:${entry._id}` }).catch((error) => console.error('Waitlist notification failed:', error.name));
    res.status(201).json({ waitlistEntry: populated });
  } catch (error) { res.status(error.code === 11000 ? 409 : 500).json({ message: error.code === 11000 ? 'This patient is already on the Vaidya waitlist for that date' : 'Unable to add patient to the waitlist' }); }
});

router.patch('/waitlist/:waitlistId', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.waitlistId)) return res.status(400).json({ message: 'Invalid waitlist ID' });
    if (req.body.action !== 'cancel') return res.status(400).json({ message: 'Unsupported waitlist action' });
    const entry = await AppointmentWaitlist.findOneAndUpdate({ _id: req.params.waitlistId, status: 'waiting' }, { $set: { status: 'cancelled', resolvedAt: new Date() } }, { new: true });
    if (!entry) return res.status(404).json({ message: 'Waiting entry not found' });
    res.json({ waitlistEntry: entry });
  } catch (_error) { res.status(500).json({ message: 'Unable to update waitlist entry' }); }
});

router.get('/reports', async (req, res) => {
  try {
    const from = req.query.from;
    const to = req.query.to;
    const validDay = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime()) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
    if (!validDay(from) || !validDay(to)) return res.status(400).json({ message: 'Choose a valid report date range' });
    const start = new Date(`${from}T00:00:00.000Z`);
    const endExclusive = new Date(`${to}T00:00:00.000Z`); endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    const rangeDays = (endExclusive - start) / 86400000;
    if (rangeDays < 1 || rangeDays > 366) return res.status(400).json({ message: 'Report range must be between 1 and 366 days' });
    const { calendarStart: clinicToday } = getClinicDateBounds();
    const [byStatus, daily, byPractitioner, missedAppointments, activeVaidyas] = await Promise.all([
      TherapySession.aggregate([
        { $match: { patient: { $ne: null }, date: { $gte: start, $lt: endExclusive } } },
        { $group: { _id: null, total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } }, cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } }, therapySessions: { $sum: { $cond: [{ $ne: [{ $ifNull: ['$treatmentPlan', null] }, null] }, 1, 0] } }, bookedMinutes: { $sum: { $cond: [{ $ne: ['$status', 'cancelled'] }, { $ifNull: ['$durationMins', 60] }, 0] } }, waitTotal: { $sum: { $cond: [{ $and: [{ $ne: [{ $ifNull: ['$checkedInAt', null] }, null] }, { $ne: [{ $ifNull: ['$queueCalledAt', null] }, null] }] }, { $divide: [{ $subtract: ['$queueCalledAt', '$checkedInAt'] }, 60000] }, 0] } }, waitCount: { $sum: { $cond: [{ $and: [{ $ne: [{ $ifNull: ['$checkedInAt', null] }, null] }, { $ne: [{ $ifNull: ['$queueCalledAt', null] }, null] }] }, 1, 0] } } } },
      ]),
      TherapySession.aggregate([
        { $match: { patient: { $ne: null }, date: { $gte: start, $lt: endExclusive } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } }, total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } }, cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } } } },
        { $sort: { _id: 1 } },
      ]),
      TherapySession.aggregate([
        { $match: { patient: { $ne: null }, practitioner: { $ne: null }, date: { $gte: start, $lt: endExclusive }, status: { $ne: 'cancelled' } } },
        { $group: { _id: '$practitioner', appointments: { $sum: 1 }, bookedMinutes: { $sum: { $ifNull: ['$durationMins', 60] } } } },
      ]),
      TherapySession.countDocuments({ patient: { $ne: null }, date: { $gte: start, $lt: clinicToday }, status: { $in: ['scheduled', 'confirmed'] }, $or: [{ checkedInAt: { $exists: false } }, { checkedInAt: null }] }),
      User.find({ userType: 'practitioner', accountStatus: { $ne: 'suspended' }, professionalStatus: { $ne: 'inactive' }, verificationStatus: 'verified' }).select('_id name availabilitySchedule').lean(),
    ]);
    const practitionerIds = byPractitioner.map((item) => item._id);
    const practitioners = practitionerIds.length ? await User.find({ _id: { $in: practitionerIds } }).select('_id name').lean() : [];
    const practitionerNames = new Map(practitioners.map((item) => [String(item._id), item.name]));
    const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const availabilityMinutes = new Map(activeVaidyas.map((person) => [String(person._id), 0]));
    for (let day = new Date(start); day < endExclusive; day.setUTCDate(day.getUTCDate() + 1)) {
      const weekday = weekdays[day.getUTCDay()];
      for (const person of activeVaidyas) for (const shift of person.availabilitySchedule || []) {
        if (shift.dayOfWeek !== weekday || shift.isAvailable === false) continue;
        const toMinutes = (time) => { const [hours, minutes] = String(time || '00:00').split(':').map(Number); return hours * 60 + minutes; };
        const duration = Math.max(0, toMinutes(shift.endTime) - toMinutes(shift.startTime));
        availabilityMinutes.set(String(person._id), (availabilityMinutes.get(String(person._id)) || 0) + duration);
      }
    }
    const totals = byStatus[0] || { total: 0, completed: 0, cancelled: 0, therapySessions: 0, bookedMinutes: 0, waitTotal: 0, waitCount: 0 };
    const providerReports = byPractitioner.map((item) => {
      const availableMinutes = availabilityMinutes.get(String(item._id)) || 0;
      return { practitionerId: item._id, name: practitionerNames.get(String(item._id)) || 'Vaidya', appointments: item.appointments, bookedMinutes: item.bookedMinutes, availableMinutes, utilizationPercent: availableMinutes ? Math.round((item.bookedMinutes / availableMinutes) * 100) : null };
    }).sort((left, right) => right.bookedMinutes - left.bookedMinutes);
    res.json({ from, to, totals: { appointments: totals.total, completed: totals.completed, cancelled: totals.cancelled, cancellationRatePercent: totals.total ? Math.round((totals.cancelled / totals.total) * 100) : 0, missed: missedAppointments, therapySessions: totals.therapySessions, averageWaitingMinutes: totals.waitCount ? Math.round(totals.waitTotal / totals.waitCount) : null }, daily, practitioners: providerReports });
  } catch (_error) { res.status(500).json({ message: 'Unable to generate receptionist reports' }); }
});

router.post('/appointments', async (req, res) => {
  const dbSession = await mongoose.startSession();
  try {
    const { patientId, slotId, therapyType = 'Consultation', waitlistId } = req.body;
    if (!mongoose.isValidObjectId(patientId) || !mongoose.isValidObjectId(slotId)) return res.status(400).json({ message: 'Select a patient and a published appointment slot' });
    if (waitlistId !== undefined && !mongoose.isValidObjectId(waitlistId)) return res.status(400).json({ message: 'Invalid waitlist request' });
    if (typeof therapyType !== 'string' || therapyType.trim().length < 2 || therapyType.length > 120) return res.status(400).json({ message: 'Invalid appointment type' });
    let created;
    await dbSession.withTransaction(async () => {
      const [patient, slot] = await Promise.all([
        User.findOne({ _id: patientId, userType: 'patient', accountStatus: { $ne: 'suspended' } }).session(dbSession),
        TherapySession.findOne({ _id: slotId, patient: null, isBooked: false, status: 'scheduled', treatmentPlan: null, sessionName: { $in: ['General Slot', 'Consultation Slot'] } }).session(dbSession),
      ]);
      if (!patient) { const error = new Error('Patient not found or inactive'); error.status = 404; throw error; }
      if (!slot) { const error = new Error('This published slot is no longer available'); error.status = 409; throw error; }
      let waitlistEntry = null;
      if (waitlistId) {
        waitlistEntry = await AppointmentWaitlist.findOne({ _id: waitlistId, patient: patient._id, practitioner: slot.practitioner, requestedDate: slot.date, therapyType: therapyType.trim(), status: 'waiting' }).session(dbSession);
        if (!waitlistEntry) { const error = new Error('The waitlist request does not match this patient, Vaidya, date and appointment type'); error.status = 409; throw error; }
      }
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
      if (waitlistId) {
        const resolved = await AppointmentWaitlist.findOneAndUpdate({ _id: waitlistId, status: 'waiting' }, { $set: { status: 'booked', appointment: created._id, resolvedAt: new Date() } }, { new: true, session: dbSession });
        if (!resolved) { const error = new Error('This waitlist request was already resolved'); error.status = 409; throw error; }
      }
    });
    await notifyUsers([created.patient, created.practitioner], 'appointment-booked', 'Appointment booked', 'A clinic appointment has been scheduled.', { dedupeKey: `appointment-booked:${created._id}` }).catch((error) => console.error('Appointment notification failed:', error.name));
    await notifyReceptionists('appointment-booked', 'Appointment booked at reception', 'A receptionist booked a patient into a published Vaidya slot.', { dedupeKey: `reception-appointment-booked:${created._id}` }).catch((error) => console.error('Reception booking notification failed:', error.name));
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
      const checkedIn = await TherapySession.findOneAndUpdate(
        { _id: appointment._id, status: { $in: ['scheduled', 'confirmed'] }, $or: [{ checkedInAt: { $exists: false } }, { checkedInAt: null }] },
        { $set: { checkedInAt: new Date(), checkedInBy: req.user._id } }, { new: true },
      );
      if (!checkedIn) return res.status(409).json({ message: 'Patient has already been checked in or the appointment changed' });
      await notifyUsers([appointment.practitioner], 'appointment-confirmed', 'Patient checked in', 'A patient has checked in for an appointment.', { dedupeKey: `appointment-checkin:${appointment._id}` }).catch((error) => console.error('Check-in notification failed:', error.name));
      return res.json({ appointment: checkedIn });
    }
    if (action === 'call-next') {
      if (!appointment.checkedInAt || !['scheduled', 'confirmed'].includes(appointment.status)) return res.status(409).json({ message: 'Only a checked-in patient can be called from the waiting queue' });
      if (appointment.queueCalledAt) return res.status(409).json({ message: 'This patient has already been called' });
      const queueStart = new Date(appointment.date); queueStart.setUTCHours(0, 0, 0, 0);
      const queueEnd = new Date(queueStart); queueEnd.setUTCDate(queueEnd.getUTCDate() + 1);
      const nextWaiting = await TherapySession.findOne({ patient: { $ne: null }, date: { $gte: queueStart, $lt: queueEnd }, checkedInAt: { $ne: null }, queueCalledAt: { $in: [null] }, status: { $in: ['scheduled', 'confirmed'] } }).sort({ checkedInAt: 1, _id: 1 }).select('_id').lean();
      if (!nextWaiting || String(nextWaiting._id) !== String(appointment._id)) return res.status(409).json({ message: 'Call the next patient in check-in order' });
      const called = await TherapySession.findOneAndUpdate(
        { _id: appointment._id, checkedInAt: { $ne: null }, queueCalledAt: { $in: [null] }, status: { $in: ['scheduled', 'confirmed'] } },
        { $set: { queueCalledAt: new Date(), queueCalledBy: req.user._id } }, { new: true },
      );
      if (!called) return res.status(409).json({ message: 'This queue entry was already updated' });
      await notifyUsers([appointment.practitioner, appointment.patient], 'appointment-confirmed', 'Patient called from reception', 'The patient has been called to the Vaidya consultation area.', { dedupeKey: `queue-called:${appointment._id}` }).catch((error) => console.error('Queue call notification failed:', error.name));
      return res.json({ appointment: called });
    }
    if (action === 'cancel') {
      if (!['scheduled', 'confirmed'].includes(appointment.status)) return res.status(409).json({ message: 'Only scheduled appointments can be cancelled' });
      const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
      if (reason.length > 1000) return res.status(400).json({ message: 'Cancellation reason must be 1000 characters or less' });
      const cancellationReason = reason || 'Cancelled by reception';
      appointment.status = 'cancelled'; appointment.cancelledReason = cancellationReason; appointment.statusHistory.push({ status: 'cancelled', changedBy: req.user._id, reason: cancellationReason }); await appointment.save();
      await notifyUsers([appointment.patient, appointment.practitioner], 'appointment-cancelled', 'Appointment cancelled', 'A clinic appointment has been cancelled.', { dedupeKey: `appointment-cancelled:${appointment._id}` }).catch((error) => console.error('Appointment cancellation notification failed:', error.name));
      await notifyReceptionists('appointment-cancelled', 'Appointment cancelled at reception', 'A scheduled appointment was cancelled.', { dedupeKey: `reception-appointment-cancelled:${appointment._id}` }).catch((error) => console.error('Reception cancellation notification failed:', error.name));
      return res.json({ appointment });
    }
    if (action === 'reschedule') {
      const { newSlotId } = req.body;
      const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
      if (reason.length > 1000) return res.status(400).json({ message: 'Reschedule reason must be 1000 characters or less' });
      const rescheduleReason = reason || 'Rescheduled by reception';
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
        current.scheduleHistory.push({ from: { date: current.date, startTime: current.startTime }, to: { date: nextDate, startTime }, changedBy: req.user._id, reason: rescheduleReason });
        current.date = nextDate; current.startTime = startTime; current.durationMins = durationMins; updated = await current.save({ session: dbSession });
      });
      await notifyUsers([updated.patient, updated.practitioner], 'appointment-rescheduled', 'Appointment rescheduled', 'A clinic appointment has been rescheduled.', { dedupeKey: `appointment-rescheduled:${updated._id}:${updated.updatedAt.getTime()}` }).catch((error) => console.error('Appointment reschedule notification failed:', error.name));
      await notifyReceptionists('appointment-rescheduled', 'Appointment rescheduled at reception', 'A clinic appointment time was changed.', { dedupeKey: `reception-appointment-rescheduled:${updated._id}:${updated.updatedAt.getTime()}` }).catch((error) => console.error('Reception reschedule notification failed:', error.name));
      return res.json({ appointment: updated });
    }
    return res.status(400).json({ message: 'Unsupported appointment action' });
  } catch (error) { res.status(error.status || 500).json({ message: error.status ? error.message : 'Appointment could not be updated' }); }
  finally { if (dbSession) await dbSession.endSession(); }
});

module.exports = router;
