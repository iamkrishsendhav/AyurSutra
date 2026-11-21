const express = require('express');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const User = require('../models/User');
const TherapySession = require('../models/TherapySession');
const { overlaps } = require('../utils/sessionTime');
const { acquireScheduleLocks } = require('../utils/scheduleLocks');
const { validateClinicSlot } = require('../utils/clinicScheduling');
const { notifyUsers, notifyReceptionists } = require('../utils/notifications');
const Notification = require('../models/Notification');
const { isValidUserPassword } = require('../utils/passwordPolicy');

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
        const nextDate = replacement.date; const startTime = replacement.startTime; const durationMins = replacement.durationMins || current.durationMins || 60;
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
