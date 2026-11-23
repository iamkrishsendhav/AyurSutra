const express = require("express");
const router = express.Router();
const TherapySession = require("../models/TherapySession");
const User = require("../models/User");
const auth = require("../middleware/auth");
const practitionerAuth = require("../middleware/practitionerAuth");
const { overlaps } = require('../utils/sessionTime');
const mongoose = require('mongoose');
const { acquireScheduleLocks } = require('../utils/scheduleLocks');
const { validateClinicSlot, getClinicSettings } = require('../utils/clinicScheduling');
const { notifyUsers } = require('../utils/notifications');
const { getClinicDateBounds } = require('../utils/clinicDate');
const clinicianAuth = (req, res, next) => ['practitioner', 'admin'].includes(req.user.userType) ? next() : res.status(403).json({ error: 'Practitioner access required' });
router.use(auth);

function practitionerCoversSlot(practitioner, date, startTime, durationMins) {
  if (!practitioner?.availabilitySchedule?.length) return true; // Explicitly published slots remain the source of availability when no weekly schedule is configured.
  const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(date).getUTCDay()];
  const hours = practitioner.availabilitySchedule.find((item) => item.dayOfWeek === dayName && item.isAvailable);
  if (!hours) return false;
  const minutes = (time) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; };
  return minutes(startTime) >= minutes(hours.startTime) && minutes(startTime) + Number(durationMins || 60) <= minutes(hours.endTime);
}

// --- Panchakarma Therapy Templates ---
const therapyTemplates = {
  Virechana: [
    { phase: "Pre", name: "Snehana", days: 3, durationMins: 60 },
    { phase: "Pre", name: "Swedana", days: 3, durationMins: 30 },
    { phase: "Main", name: "Virechana", days: 1, durationMins: 180 },
    { phase: "Post", name: "Recovery", days: 3, durationMins: 20 },
  ],
  Vamana: [
    { phase: "Pre", name: "Snehana", days: 3, durationMins: 60 },
    { phase: "Pre", name: "Swedana", days: 3, durationMins: 30 },
    { phase: "Main", name: "Vamana", days: 1, durationMins: 180 },
    { phase: "Post", name: "Recovery", days: 4, durationMins: 20 },
  ],
};

// ✅ Practitioner creates custom free slots (your existing logic)
router.post("/create", clinicianAuth, async (req, res) => {
  const transaction = await mongoose.startSession();
  try {
    const { date, times } = req.body;
    if (!Array.isArray(times) || !times.length || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({ error: 'Valid date and times are required' });
    const practitionerUser = await User.findById(req.user._id);
    if (!practitionerUser || (req.user.userType !== 'admin' && practitionerUser.userType !== 'practitioner')) return res.status(404).json({ error: 'Practitioner account not found' });
    const clinicSettings = await getClinicSettings();
    const durationMins = clinicSettings?.defaultSessionDurationMins || 60;
    const uniqueTimes = [...new Set(times)];
    for (const time of uniqueTimes) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return res.status(400).json({ error: 'Invalid appointment time; use HH:MM' });
      if (!practitionerCoversSlot(practitionerUser, date, time, durationMins)) return res.status(400).json({ error: 'Slot is outside the Vaidya availability schedule' });
      const clinicError = await validateClinicSlot({ date, startTime: time, durationMins });
      if (clinicError) return res.status(400).json({ error: clinicError });
    }
    const sortedTimes = [...uniqueTimes].sort();
    if (sortedTimes.some((time, index) => index > 0 && overlaps(sortedTimes[index - 1], durationMins, time, durationMins))) return res.status(409).json({ error: 'Published consultation slots overlap each other' });
    const dateValue = new Date(date);
    await transaction.withTransaction(async () => {
      await acquireScheduleLocks(transaction, { date: dateValue, practitionerId: practitionerUser._id });
      const dayStart = new Date(dateValue); dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart); dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
      const existing = await TherapySession.find({ practitioner: practitionerUser._id, date: { $gte: dayStart, $lt: dayEnd }, status: { $ne: 'cancelled' } }).select('startTime durationMins').session(transaction);
      if (uniqueTimes.some((time) => existing.some((item) => overlaps(time, durationMins, item.startTime, item.durationMins || 60)))) {
        const error = new Error('A published slot overlaps an existing appointment or open slot'); error.status = 409; throw error;
      }
      const slots = uniqueTimes.map((time) => ({ practitioner: practitionerUser._id, date: dateValue, startTime: time, durationMins, therapyType: "Custom", phase: "Pre", sessionName: "General Slot" }));
      await TherapySession.insertMany(slots, { session: transaction });
    });
    res.json({ message: "Slots created successfully" });
  } catch (err) {
    console.error("Error creating slots:", err.name);
    res.status(err.status || 500).json({ error: err.status ? err.message : "Server error" });
  } finally { await transaction.endSession(); }
});

// ✅ Auto-generate therapy schedule
router.post("/autogenerate", clinicianAuth, async (req, res) => {
  return res.status(409).json({ error: 'Approved treatment plans are not supported yet; sessions cannot be safely generated from a plan.' });
  /* legacy template code retained until an approved plan model and workflow exist
  try {
    const { practitionerEmail, patientEmail, therapyType, startDate } = req.body;

    const practitioner = await User.findOne({ email: practitionerEmail });
    const patient = await User.findOne({ email: patientEmail });

    if (!practitioner || !patient) {
      return res.status(404).json({ error: "Practitioner or patient not found" });
    }
    if (!therapyTemplates[therapyType]) {
      return res.status(400).json({ error: "Invalid therapy type" });
    }

    let currentDate = new Date(startDate);
    const sessions = [];

    therapyTemplates[therapyType].forEach((step) => {
      for (let i = 0; i < step.days; i++) {
        sessions.push({
          practitioner: practitioner._id,
          patient: patient._id,
          therapyType,
          phase: step.phase,
          sessionName: step.name,
          date: new Date(currentDate),
          startTime: "09:00", // default, can be edited later
          durationMins: step.durationMins,
          isBooked: true,
        });
        currentDate.setDate(currentDate.getDate() + 1); // move to next day
      }
    });

    await TherapySession.insertMany(sessions);
    res.json({ message: "Therapy schedule created", sessions });
  } catch (err) {
    console.error("Error auto-generating schedule:", err);
    res.status(500).json({ error: "Server error" });
  }
  */
});

// ✅ Get available slots (patients)
router.get("/available", async (req, res) => {
  try {
    if (!['patient', 'practitioner', 'admin', 'receptionist'].includes(req.user.userType)) return res.status(403).json({ error: 'Access denied' });
    const filter = { isBooked: false, patient: null, status: 'scheduled', treatmentPlan: null, date: { $gte: new Date(new Date().setUTCHours(0, 0, 0, 0)) } };
    if (req.query.date !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) return res.status(400).json({ error: 'Choose a valid date.' });
      const dateStart = new Date(`${req.query.date}T00:00:00.000Z`);
      if (Number.isNaN(dateStart.getTime()) || dateStart.toISOString().slice(0, 10) !== req.query.date) return res.status(400).json({ error: 'Choose a valid date.' });
      if (req.query.date < getClinicDateBounds().date) return res.status(400).json({ error: 'Availability date cannot be in the past.' });
      const dateEnd = new Date(dateStart); dateEnd.setUTCDate(dateEnd.getUTCDate() + 1);
      filter.date = { $gte: dateStart, $lt: dateEnd };
    }
    if (req.query.practitionerId) {
      if (!mongoose.isValidObjectId(req.query.practitionerId)) return res.status(400).json({ error: 'Invalid practitioner' });
      filter.practitioner = req.query.practitionerId;
    }
    const slots = await TherapySession.find(filter).select('_id practitioner date startTime durationMins therapyType phase sessionName status isBooked').populate("practitioner", "name practiceLocation practiceAreas qualifications availabilitySchedule profileImageUrl verificationStatus professionalStatus accountStatus").sort({ date: 1, startTime: 1 }).limit(300).lean();
    const available = slots.filter((slot) => slot.practitioner?.verificationStatus === 'verified' && slot.practitioner?.professionalStatus !== 'inactive' && slot.practitioner?.accountStatus !== 'suspended' && practitionerCoversSlot(slot.practitioner, slot.date, slot.startTime, slot.durationMins || 60));
    if (req.query.includeUnavailable !== 'true' || req.user.userType !== 'patient' || !req.query.date || !req.query.practitionerId) return res.json(available);

    const eligiblePractitioner = await User.findOne({ _id: req.query.practitionerId, userType: 'practitioner', verificationStatus: 'verified', availableForNewPatients: true, professionalStatus: { $ne: 'inactive' }, accountStatus: { $ne: 'suspended' } }).select('_id').lean();
    if (!eligiblePractitioner) return res.json([]);
    const dateStart = filter.date.$gte;
    const dateEnd = filter.date.$lt;
    const bookedSlots = await TherapySession.find({
      practitioner: req.query.practitionerId,
      date: { $gte: dateStart, $lt: dateEnd },
      treatmentPlan: null,
      status: { $ne: 'cancelled' },
      $and: [
        { $or: [{ sessionName: { $in: ['General Slot', 'Consultation Slot', 'Clinic Appointment'] } }, { therapyType: { $in: ['Custom', 'Consultation'] } }] },
        { $or: [{ isBooked: true }, { patient: { $ne: null } }, { status: { $ne: 'scheduled' } }] },
      ],
    }).select('_id date startTime durationMins').sort({ startTime: 1 }).limit(100).lean();
    const visibleSlots = [
      ...available.map((slot) => ({ _id: slot._id, date: slot.date, startTime: slot.startTime, durationMins: slot.durationMins, isAvailable: true })),
      ...bookedSlots.map((slot) => ({ _id: `unavailable-${slot.startTime}`, date: slot.date, startTime: slot.startTime, durationMins: slot.durationMins, isAvailable: false })),
    ].sort((first, second) => first.startTime.localeCompare(second.startTime));
    return res.json(visibleSlots);
  } catch (err) {
    console.error("Error fetching slots:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Get patient’s booked sessions
router.get("/my-slots/:email", async (req, res) => {
  try {
    if (req.user.userType !== 'patient' || String(req.user.email).toLowerCase() !== String(req.params.email).toLowerCase()) return res.status(403).json({ error: 'Patients may only view their own sessions' });
    const patient = await User.findById(req.user._id);
    if (!patient) return res.status(404).json({ error: "Patient not found" });

    const slots = await TherapySession.find({ patient: patient._id })
      .populate("practitioner", "name email userType");
    res.json(slots);
  } catch (err) {
    console.error("Error fetching patient slots:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Get practitioner’s sessions
router.get("/practitioner-slots/:email", async (req, res) => {
  try {
    if (req.user.userType !== 'practitioner' || String(req.user.email).toLowerCase() !== String(req.params.email).toLowerCase()) return res.status(403).json({ error: 'Practitioners may only view their own sessions' });
    const practitioner = await User.findById(req.user._id);
    if (!practitioner) return res.status(404).json({ error: "Practitioner not found" });

    const slots = await TherapySession.find({ practitioner: practitioner._id })
      .populate("patient", "name email userType");
    res.json(slots);
  } catch (err) {
    console.error("Error fetching practitioner slots:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Book a free slot (patient)
router.post("/book/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid consultation slot' });
  if (req.body?.reason !== undefined && (typeof req.body.reason !== 'string' || req.body.reason.length > 500)) return res.status(400).json({ error: 'Reason must be 500 characters or less' });
  const transaction = await mongoose.startSession();
  try {
    if (req.user.userType !== 'patient') return res.status(403).json({ error: 'Patient access required' });
    let booked;
    await transaction.withTransaction(async () => {
      const patientUser = await User.findById(req.user._id).session(transaction);
      const slot = await TherapySession.findById(req.params.id).session(transaction);
      if (!slot) { const e = new Error('Slot not found'); e.status = 404; throw e; }
      const isConsultationSlot = !slot.treatmentPlan && ['General Slot', 'Consultation Slot'].includes(slot.sessionName) || !slot.treatmentPlan && ['Custom', 'Consultation'].includes(slot.therapyType);
      if (!patientUser || slot.isBooked || slot.patient || slot.status !== 'scheduled' || !isConsultationSlot) { const e = new Error('This slot is not available for patient consultation booking'); e.status = 409; throw e; }
      const clinicError = await validateClinicSlot({ date: slot.date, startTime: slot.startTime, durationMins: slot.durationMins || 60 }, transaction);
      if (clinicError) { const e = new Error(clinicError); e.status = 400; throw e; }
      await acquireScheduleLocks(transaction, { date: slot.date, patientId: patientUser._id, practitionerId: slot.practitioner });
      if (slot.practitioner) {
        const practitioner = await User.findOne({ _id: slot.practitioner, userType: 'practitioner', verificationStatus: 'verified', professionalStatus: { $ne: 'inactive' }, accountStatus: { $ne: 'suspended' } }).select('practiceAreas').session(transaction);
        if (!practitioner) { const e = new Error('This Vaidya is unavailable for booking'); e.status = 409; throw e; }
        const fullPractitioner = await User.findById(slot.practitioner).select('availabilitySchedule').session(transaction);
        if (!practitionerCoversSlot(fullPractitioner, slot.date, slot.startTime, slot.durationMins || 60)) { const e = new Error('Slot is outside the Vaidya availability schedule'); e.status = 409; throw e; }
      }
      const dayStart = new Date(slot.date); dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
      const existing = await TherapySession.find({ date: { $gte: dayStart, $lt: dayEnd }, status: { $ne: 'cancelled' }, patient: { $ne: null }, _id: { $ne: slot._id }, $or: [{ patient: patientUser._id }, ...(slot.practitioner ? [{ practitioner: slot.practitioner }] : [])] }).select('startTime durationMins').session(transaction);
      if (existing.some((item) => overlaps(slot.startTime, slot.durationMins || 60, item.startTime, item.durationMins || 60))) { const e = new Error('Patient or practitioner has an overlapping session'); e.status = 409; throw e; }
      booked = await TherapySession.findOneAndUpdate(
        { _id: slot._id, isBooked: false, patient: null, status: 'scheduled' },
        { $set: { isBooked: true, patient: patientUser._id, ...(typeof req.body.reason === 'string' && req.body.reason.trim() ? { notes: req.body.reason.trim().slice(0, 500) } : {}) } },
        { new: true, runValidators: true, session: transaction }
      );
      if (!booked) { const e = new Error('Slot was booked by another patient'); e.status = 409; throw e; }
    });
    await notifyUsers([req.user._id, booked.practitioner], 'appointment-booked', 'Appointment booked', 'Your therapy appointment has been booked.', { dedupeKey: `appointment-booked:${booked._id}` });
    res.json({ message: 'Slot booked successfully', session: booked });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Server error' });
  } finally { await transaction.endSession(); }
});

// ✅ Practitioner edits a session
router.put("/edit/:id", clinicianAuth, async (req, res) => {
  try {
    const { date, startTime, durationMins, notes } = req.body;
    const slot = await TherapySession.findById(req.params.id);
    if (!slot) return res.status(404).json({ error: 'Session not found' });
    if (req.user.userType !== 'admin' && String(slot.practitioner) !== String(req.user._id)) return res.status(403).json({ error: 'Not authorized' });
    if (slot.patient) return res.status(400).json({ error: 'Booked sessions must be rescheduled through the session endpoint' });
    Object.assign(slot, { date, startTime, durationMins, notes });
    const updatedSlot = await slot.save();
    if (!updatedSlot) return res.status(404).json({ error: "Session not found" });
    res.json({ message: "Session updated", updatedSlot });
  } catch (err) {
    console.error("Error editing session:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Delete a slot (only if not booked)
router.delete("/delete/:id", async (req, res) => {
  try {
    if (!['practitioner', 'admin'].includes(req.user.userType)) return res.status(403).json({ error: 'Practitioner access required' });
    const slot = await TherapySession.findById(req.params.id);
    if (!slot) return res.status(404).json({ error: "Slot not found" });

    if (slot.isBooked) {
      return res.status(400).json({ error: "Cannot delete a booked slot" });
    }
    if (req.user.userType !== 'admin' && String(slot.practitioner) !== String(req.user._id)) return res.status(403).json({ error: 'Not authorized' });

    await TherapySession.findByIdAndDelete(req.params.id);
    res.json({ message: "Slot deleted successfully" });
  } catch (err) {
    console.error("Error deleting slot:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;

