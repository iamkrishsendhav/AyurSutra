const express = require("express");
const router = express.Router();
const TherapySession = require("../models/TherapySession");
const User = require("../models/User");
const { sendAppointmentConfirmation } = require("../utils/whatsapp");
const { overlaps } = require("../utils/sessionTime");
const auth = require("../middleware/auth");
const practitionerAuth = require("../middleware/practitionerAuth");
const mongoose = require('mongoose');
const { Types } = mongoose;
const { canTransition } = require('../utils/sessionLifecycle');
const { canManageSession, canCancelSession } = require('../utils/sessionAccess');
const { acquireScheduleLocks } = require('../utils/scheduleLocks');
const { validateClinicSlot } = require('../utils/clinicScheduling');
const { notifyUsers, notifyAdmins } = require('../utils/notifications');
const Notification = require('../models/Notification');

async function closePendingSessionReminders(sessionId, reason) {
  try { await Notification.updateMany({ session: sessionId, type: 'session-reminder', read: false }, { $set: { read: true, 'payload.body': reason } }); }
  catch (error) { console.error('Unable to update superseded reminder:', error.name); }
}

function patientSafeSession(session) {
  const item = session.toObject ? session.toObject() : { ...session };
  item.clinicalRecord = item.clinicalRecord ? {
    actualStartedAt: item.clinicalRecord.actualStartedAt,
    actualCompletedAt: item.clinicalRecord.actualCompletedAt,
    actualDurationMins: item.clinicalRecord.actualDurationMins,
  } : undefined;
  delete item.practitionerNotes;
  delete item.notes;
  delete item.recommendations;
  delete item.metrics;
  if (Array.isArray(item.statusHistory)) item.statusHistory = item.statusHistory.map(({ status, changedAt }) => ({ status, changedAt }));
  return item;
}

function practitionerCoversTime(practitioner, date, startTime, durationMins) {
  if (!practitioner?.availabilitySchedule?.length) return true;
  const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(date).getUTCDay()];
  const availability = practitioner.availabilitySchedule.find((item) => item.dayOfWeek === day && item.isAvailable);
  if (!availability) return false;
  const minutes = (value) => { const [hours, mins] = value.split(':').map(Number); return hours * 60 + mins; };
  return minutes(startTime) >= minutes(availability.startTime) && minutes(startTime) + Number(durationMins || 60) <= minutes(availability.endTime);
}

router.use(auth);

// For debugging
const debug = require('debug')('ayursutra:sessions');

// -------------------- GET all sessions --------------------
router.get("/", async (req, res) => {
  try {
    let sessions;

    if (req.user.userType === "admin") {
      sessions = await TherapySession.find()
        .populate("patient", "name email phone")
        .populate('practitioner', 'name email profileImageUrl practiceAreas')
        .populate('treatmentPlan', 'title status startDate objectives precautions therapies')
        .sort({ date: 1, startTime: 1 });
    } else if (req.user.userType === "practitioner") {
      sessions = await TherapySession.find({ practitioner: req.user._id })
        .populate("patient", "name email phone")
        .populate('practitioner', 'name email profileImageUrl practiceAreas')
        .populate('treatmentPlan', 'title status startDate objectives precautions therapies')
        .sort({ date: 1, startTime: 1 });
    } else {
      sessions = await TherapySession.find({ patient: req.user._id })
        .populate("patient", "name email phone")
        .populate('practitioner', 'name email profileImageUrl practiceAreas')
        .populate('treatmentPlan', 'title status startDate objectives precautions therapies')
        .sort({ date: 1, startTime: 1 });
    }

    if (req.user.userType === 'patient') {
      const patientSafeSessions = sessions.map(patientSafeSession);
      return res.json(patientSafeSessions);
    }
    res.json(sessions);
  } catch (err) {
    console.error("Error fetching sessions:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

// -------------------- POST: Generate full therapy schedule --------------------
router.post("/", async (req, res) => {
  if (!['practitioner', 'admin'].includes(req.user.userType)) return res.status(403).json({ msg: 'Practitioner access required' });
  return res.status(409).json({ msg: 'Approved treatment plans are not supported yet; sessions cannot be generated safely.' });
  /* Existing template generator retained pending an approved treatment plan model.
  const { patientId, therapyType, startDate, slotTimes } = req.body;

  if (!patientId || !therapyType || !startDate) {
    return res.status(400).json({ msg: "Please provide patientId, therapyType, and startDate" });
  }

  try {
    // Find patient by email
    const patient = Types.ObjectId.isValid(patientId)
      ? await User.findById(patientId)
      : await User.findOne({ email: patientId });
    if (!patient) return res.status(404).json({ msg: "Patient not found" });
    if (patient.userType !== 'patient') return res.status(400).json({ msg: 'A patient account is required' });
    if (req.user.userType === 'practitioner' && String(patient.assignedPractitioner) !== String(req.user._id)) {
      return res.status(403).json({ msg: 'Patient is not assigned to this practitioner' });
    }
    

    // Panchakarma schedule template
    const therapyTemplate = {
      Virechana: [
        { phase: "Pre", sessionName: "Preparation 1", daysAfterStart: 0 },
        { phase: "Pre", sessionName: "Preparation 2", daysAfterStart: 1 },
        { phase: "Main", sessionName: "Virechana Procedure", daysAfterStart: 2 },
        { phase: "Post", sessionName: "Dietary Follow-up", daysAfterStart: 3 },
        { phase: "Post", sessionName: "Check-up", daysAfterStart: 4 },
      ],
      Vamana: [
        { phase: "Pre", sessionName: "Preparation 1", daysAfterStart: 0 },
        { phase: "Main", sessionName: "Vamana Procedure", daysAfterStart: 1 },
        { phase: "Post", sessionName: "Dietary Follow-up", daysAfterStart: 2 },
        { phase: "Post", sessionName: "Check-up", daysAfterStart: 3 },
      ],
    };

    const template = therapyTemplate[therapyType];
    if (!template) return res.status(400).json({ msg: "Invalid therapyType" });

    // slotTimes: optional array of start times for each session
    const sessions = await Promise.all(template.map(async (item, idx) => {
      const date = new Date(startDate);
      date.setDate(date.getDate() + item.daysAfterStart);
      const sessionDate = date.toISOString().split("T")[0];
      const startTime = slotTimes && slotTimes[idx] ? slotTimes[idx] : "10:00";

      // Skip creating sessions that would be in the past
      const sessionDateObj = new Date(sessionDate);
      if (sessionDateObj < new Date(new Date().setHours(0,0,0,0))) {
        // return null for past session entries so we can filter them out later
        return null;
      }

      // Conflict check: is there already a session at this date/time? Ignore cancelled
      const dayStart = new Date(sessionDate); const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
      const existing = await TherapySession.find({ date: { $gte: dayStart, $lt: dayEnd }, status: { $ne: 'cancelled' }, $or: [{ patient: patient._id }, { practitioner: req.user._id }] }).select('startTime durationMins');
      const conflict = existing.some((entry) => overlaps(startTime, item.durationMins || 60, entry.startTime, entry.durationMins || 60));
      if (conflict) {
        throw new Error(`Slot conflict on ${sessionDate} at ${startTime}`);
      }

      return {
        patient: patient._id,
        practitioner: req.user.userType === 'practitioner' ? req.user._id : patient.assignedPractitioner,
        therapyType,
        phase: item.phase,
        sessionName: item.sessionName,
        date: sessionDate,
        startTime,
        status: 'scheduled', // Make sure this is lowercase
      };
    }));

    // Filter out nulls (past sessions) and ensure practitioner/status are set
    const sessionsFiltered = sessions.filter(Boolean).map(session => ({
      ...session,
      practitioner: session.practitioner,
      status: String(session.status || 'scheduled').toLowerCase()
    }));

    const createdSessions = await TherapySession.insertMany(sessionsFiltered);

    // Send WhatsApp notifications for each created session
    if (patient.phone) {
      for (const session of createdSessions) {
        try {
          console.log(`Sending WhatsApp notification for session ${session._id} to ${patient.phone}`);
          await sendAppointmentConfirmation({
            therapyType: session.therapyType,
            sessionName: session.sessionName,
            date: session.date,
            startTime: session.startTime
          }, patient.phone);
          console.log(`WhatsApp notification sent successfully for session ${session._id}`);
        } catch (error) {
          console.error('Error sending WhatsApp confirmation:', {
            sessionId: session._id,
            error: error.message,
            phone: patient.phone
          });
          // Continue with other sessions even if one notification fails
        }
      }
    } else {
      console.log(`No phone number found for patient: ${patient.email}`);
    }

    res.json(createdSessions);
  } catch (err) {
    console.error("Error generating therapy schedule:", err);
    res.status(500).json({ msg: err.message || "Server error" });
  }
  */
});

// -------------------- PUT: Update session --------------------
router.put("/:id", async (req, res) => {
  try {
    const { date, startTime, notes, status, sessionName, phase, therapyType } = req.body;
    const session = await TherapySession.findById(req.params.id).populate('patient');
    if (!session) return res.status(404).json({ msg: "Session not found" });
    const isPatient = req.user.userType === 'patient';
    const isAdmin = req.user.userType === 'admin';
    if (!canManageSession(req.user, session)) return res.status(403).json({ msg: "Not authorized to edit this session" });
    if (isPatient && (session.status !== 'scheduled' || (status && status !== 'cancelled') || sessionName || phase || therapyType || notes)) {
      return res.status(403).json({ msg: 'Patients may only reschedule or cancel scheduled sessions' });
    }
    // The specific session assignment authorizes its execution Vaidya. The patient's
    // primary clinician can differ from the practitioner assigned to this session.

    // Preserve existing values if not provided
    if (!isPatient) {
      if (sessionName) session.sessionName = sessionName;
      if (phase) session.phase = phase;
      if (therapyType) session.therapyType = therapyType;
    }

    // Status update
    let nextNotificationStatus = null;
    if (status) {
      // Normalize status (lowercase + trim) and log for debugging
      const normalizedStatus = String(status).toLowerCase().trim();
      nextNotificationStatus = normalizedStatus;
      if (!canTransition(session.status, normalizedStatus)) return res.status(400).json({ msg: `Invalid session transition: ${session.status} to ${normalizedStatus}` });

      // If the update is a cancellation (accept common variants), perform a direct update
      // to avoid triggering full document validation. This allows cancelling even if
      // some required fields are missing on the stored document.
      if (normalizedStatus.startsWith('cancel')) {
        const reason = req.body.cancelledReason;
        if (reason !== undefined && (typeof reason !== 'string' || reason.length > 1000)) return res.status(400).json({ msg: 'Cancellation reason must be 1000 characters or less' });
        const updated = await TherapySession.findByIdAndUpdate(
          req.params.id,
          { $set: { status: 'cancelled', ...(reason ? { cancelledReason: reason.trim() } : {}) }, $push: { statusHistory: { status: 'cancelled', changedAt: new Date(), changedBy: req.user._id, ...(reason ? { reason: reason.trim() } : {}) } } },
          { new: true }
        ).populate('patient');

        if (!updated) return res.status(404).json({ msg: 'Session not found' });
        await closePendingSessionReminders(updated._id, 'This session was cancelled.');
        await notifyUsers([updated.patient?._id || updated.patient, updated.practitioner], 'appointment-cancelled', 'Appointment cancelled', 'A therapy appointment has been cancelled.', { dedupeKey: `appointment-cancelled:${updated._id}` });
        await notifyAdmins('appointment-cancelled', 'Appointment cancelled', 'A therapy appointment was cancelled.', { dedupeKey: `appointment-cancelled-admin:${updated._id}` });
        return res.json({ msg: 'Session updated', session: isPatient ? patientSafeSession(updated) : updated });
      }

      try {
        // For non-cancellation statuses, use the model setter which performs
        // normalization/validation.
        session.status = status;
      } catch (err) {
        console.error('Status validation error:', err);
        return res.status(400).json({ 
          msg: err.message,
          debug: { 
            receivedStatus: status,
            allowedValues: ['scheduled', 'completed', 'cancelled', 'in-progress']
          }
        });
      }

      // If session doesn't have a practitioner, assign a default one
      session.status = normalizedStatus;
      session.statusHistory.push({ status: normalizedStatus, changedAt: new Date(), changedBy: req.user._id });
      if (normalizedStatus === 'in-progress' && !session.clinicalRecord?.actualStartedAt) {
        session.clinicalRecord = { ...(session.clinicalRecord?.toObject?.() || session.clinicalRecord || {}), actualStartedAt: new Date() };
      }
      if (normalizedStatus === 'completed') {
        const completedAt = new Date();
        const startedAt = session.clinicalRecord?.actualStartedAt;
        const actualDurationMins = startedAt ? Math.max(0, Math.round((completedAt - new Date(startedAt)) / 60000)) : undefined;
        session.clinicalRecord = { ...(session.clinicalRecord?.toObject?.() || session.clinicalRecord || {}), actualCompletedAt: completedAt, ...(actualDurationMins !== undefined ? { actualDurationMins } : {}) };
      }
    }

    // Date/Time update (reschedule): perform safe partial update to avoid full
    // document validation (which can fail when other required fields are missing).
    if (date || startTime) {
      try {
        // If cancelling, we handled above. For rescheduling, validate inputs.
        // Only check conflicts for rescheduling.
        const candidateDate = date ? new Date(date) : new Date(session.date);
        const candidateStartTime = startTime || session.startTime;
        if (Number.isNaN(candidateDate.getTime())) return res.status(400).json({ msg: 'Invalid session date' });
        if (candidateDate && candidateStartTime) {
          const dayStart = new Date(candidateDate); dayStart.setHours(0, 0, 0, 0);
          const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
          if (candidateDate < new Date(new Date().setHours(0,0,0,0))) {
            return res.status(400).json({ msg: 'Cannot schedule session in the past' });
          }
          if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(candidateStartTime)) {
            return res.status(400).json({ msg: 'Invalid time format. Use HH:MM' });
          }
          const assignedPractitioner = session.practitioner ? await User.findById(session.practitioner).select('availabilitySchedule') : null;
          if (!practitionerCoversTime(assignedPractitioner, candidateDate, candidateStartTime, session.durationMins || 60)) return res.status(409).json({ msg: 'Selected time is outside the practitioner availability schedule' });

          const mongoSession = await mongoose.startSession();
          let updated;
          try {
            await mongoSession.withTransaction(async () => {
              const clinicError = await validateClinicSlot({ date: candidateDate, startTime: candidateStartTime, durationMins: session.durationMins || 60 }, mongoSession);
              if (clinicError) { const error = new Error(clinicError); error.code = 'CLINIC_RULE'; throw error; }
              await acquireScheduleLocks(mongoSession, {
                date: candidateDate,
                patientId: session.patient?._id || session.patient,
                practitionerId: session.practitioner,
              }, mongoSession);
              const candidates = await TherapySession.find({
            date: { $gte: dayStart, $lt: dayEnd },
            _id: { $ne: session._id },
            status: { $ne: 'cancelled' },
                patient: { $ne: null },
                $or: [{ practitioner: session.practitioner }, { patient: session.patient?._id || session.patient }]
              }).select('startTime durationMins').session(mongoSession);
          const conflict = candidates.some((existing) => overlaps(
                candidateStartTime, session.durationMins || 60,
            existing.startTime, existing.durationMins || 60
          ));
          if (conflict) {
                const error = new Error(`Slot conflict on ${date || candidateDate.toISOString()} at ${candidateStartTime}`);
                error.code = 'SLOT_CONFLICT';
                throw error;
          }
              const setObj = {};
              if (date) setObj.date = candidateDate;
              if (startTime) setObj.startTime = startTime;
              updated = await TherapySession.findByIdAndUpdate(
                req.params.id,
                { $set: setObj, $push: { scheduleHistory: { from: { date: session.date, startTime: session.startTime }, to: { date: candidateDate, startTime: candidateStartTime }, changedAt: new Date(), changedBy: req.user._id } } },
                { new: true, session: mongoSession }
              );
              if (!updated) {
                const error = new Error('Session not found');
                error.code = 'SESSION_NOT_FOUND';
                throw error;
              }
            });
          } finally {
            await mongoSession.endSession();
          }
          await updated.populate('patient');
          await closePendingSessionReminders(updated._id, 'This session was rescheduled. Review the updated appointment details.');
          await notifyUsers([updated.patient?._id || updated.patient, updated.practitioner], 'appointment-rescheduled', 'Appointment rescheduled', `Your therapy session is now scheduled for ${new Date(updated.date).toLocaleDateString()} at ${updated.startTime}.`, { dedupeKey: `appointment-rescheduled:${updated._id}:${updated.scheduleHistory?.at(-1)?.changedAt?.getTime?.() || Date.now()}` });
          return res.json({ msg: 'Session rescheduled', session: isPatient ? patientSafeSession(updated) : updated });
        }
      } catch (err) {
        if (!['SLOT_CONFLICT', 'CLINIC_RULE'].includes(err.code)) console.error('Error updating session date/time:', err);
        if (err.code === 'SLOT_CONFLICT') return res.status(409).json({ msg: err.message });
        if (err.code === 'CLINIC_RULE') return res.status(400).json({ msg: err.message });
        if (err.code === 'SESSION_NOT_FOUND') return res.status(404).json({ msg: err.message });
        if (err.code === 112 || err.code === 11000) return res.status(409).json({ msg: 'Session schedule changed concurrently; retry the request' });
        return res.status(500).json({ msg: err.message || 'Error updating session' });
      }
    }

    // Notes update
    if (notes) session.notes = notes;

    try {
      const updatedSession = await session.save();
      const notificationType = nextNotificationStatus === 'confirmed' ? 'appointment-confirmed' : nextNotificationStatus === 'in-progress' ? 'session-started' : nextNotificationStatus === 'completed' ? 'session-completed' : null;
      if (notificationType) await notifyUsers([updatedSession.patient, updatedSession.practitioner], notificationType, notificationType === 'appointment-confirmed' ? 'Appointment confirmed' : notificationType === 'session-started' ? 'Therapy session started' : 'Therapy session completed', notificationType === 'appointment-confirmed' ? 'Your therapy appointment has been confirmed.' : notificationType === 'session-started' ? 'Your therapy session has started.' : 'Your therapy session has been completed.', { dedupeKey: `${notificationType}:${updatedSession._id}` });
      res.json({ 
        msg: "Session updated", 
        session: updatedSession,
        debug: {
          originalStatus: status,
          finalStatus: updatedSession.status
        }
      });
    } catch (err) {
      console.error('Error saving session:', err);
      return res.status(400).json({ 
        msg: err.message || 'Failed to update session',
        debug: {
          receivedStatus: status,
          normalizedStatus: session.status,
          validStatuses: ['scheduled', 'completed', 'cancelled', 'in-progress']
        }
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: err.message || "Server error" });
  }
});

// Structured practitioner documentation is separate from the approved plan.
router.patch('/:id/clinical-record', async (req, res) => {
  try {
    if (!['practitioner', 'admin'].includes(req.user.userType)) return res.status(403).json({ msg: 'Practitioner access required' });
    const session = await TherapySession.findById(req.params.id).populate('patient', 'assignedPractitioner name');
    if (!session) return res.status(404).json({ msg: 'Session not found' });
    if (!canManageSession(req.user, session)) return res.status(403).json({ msg: 'Not authorized to document this session' });
    const allowed = ['observations', 'treatmentNotes', 'completionRemarks', 'followUpRecommendations'];
    for (const key of allowed) {
      if (req.body[key] !== undefined && (typeof req.body[key] !== 'string' || req.body[key].length > (key === 'completionRemarks' || key === 'followUpRecommendations' ? 3000 : 5000))) return res.status(400).json({ msg: `Invalid ${key}` });
    }
    const clinicalRecord = session.clinicalRecord?.toObject?.() || { ...(session.clinicalRecord || {}) };
    for (const key of allowed) if (req.body[key] !== undefined) clinicalRecord[key] = req.body[key].trim();
    clinicalRecord.updatedBy = req.user._id;
    clinicalRecord.updatedAt = new Date();
    session.clinicalRecord = clinicalRecord;
    await session.save();
    res.json({ session: req.user.userType === 'patient' ? patientSafeSession(session) : session });
  } catch (error) { console.error('Session clinical record update failed:', error); res.status(500).json({ msg: 'Unable to save session record' }); }
});

router.post('/:id/feedback', async (req, res) => {
  try {
    if (req.user.userType !== 'patient') return res.status(403).json({ msg: 'Patient access required' });
    const session = await TherapySession.findOne({ _id: req.params.id, patient: req.user._id });
    if (!session) return res.status(404).json({ msg: 'Session not found' });
    if (session.status !== 'completed') return res.status(400).json({ msg: 'Feedback is available after session completion' });
    if (session.feedback?.submittedAt || session.feedback?.wellness !== undefined) return res.status(409).json({ msg: 'Feedback has already been submitted' });
    const rating = Number(req.body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ msg: 'Rating must be between 1 and 5' });
    if (req.body.comments !== undefined && (typeof req.body.comments !== 'string' || req.body.comments.length > 2000)) return res.status(400).json({ msg: 'Feedback comments are invalid' });
    const submittedAt = new Date();
    const result = await TherapySession.updateOne(
      { _id: session._id, patient: req.user._id, status: 'completed', 'feedback.submittedAt': { $exists: false }, 'feedback.wellness': { $exists: false } },
      { $set: { 'feedback.wellness': rating, 'feedback.comments': (req.body.comments || '').trim(), 'feedback.submittedAt': submittedAt } },
      { runValidators: true }
    );
    if (!result.modifiedCount) return res.status(409).json({ msg: 'Feedback has already been submitted' });
    await notifyUsers([session.practitioner], 'feedback-received', 'Patient feedback received', 'A patient submitted feedback for a completed session.', { dedupeKey: `feedback:${session._id}` });
    res.status(201).json({ message: 'Feedback submitted', feedback: { wellness: rating, comments: (req.body.comments || '').trim(), submittedAt } });
  } catch (error) { console.error('Session feedback submission failed:', error); res.status(500).json({ msg: 'Unable to submit feedback' }); }
});

// -------------------- DELETE: Cancel session --------------------
router.delete("/delete/:id", async (req, res) => {
  try {
    const session = await TherapySession.findById(req.params.id).populate('patient');
    if (!session) return res.status(404).json({ msg: "Session not found" });
    const authorized = canCancelSession(req.user, session);
    if (!authorized) return res.status(403).json({ msg: "Not authorized to cancel this session" });
    if (session.status === 'completed' || session.status === 'cancelled') return res.status(400).json({ msg: 'Session cannot be cancelled in its current status' });
    session.status = 'cancelled';
    session.statusHistory.push({ status: 'cancelled', changedAt: new Date(), changedBy: req.user._id });
    await session.save();
    await closePendingSessionReminders(session._id, 'This session was cancelled.');
    await notifyUsers([session.patient?._id || session.patient, session.practitioner], 'appointment-cancelled', 'Appointment cancelled', 'A therapy appointment has been cancelled.', { dedupeKey: `appointment-cancelled:${session._id}` });
    await notifyAdmins('appointment-cancelled', 'Appointment cancelled', 'A therapy appointment was cancelled.', { dedupeKey: `appointment-cancelled-admin:${session._id}` });
    res.json({ msg: "Session cancelled", session: req.user.userType === 'patient' ? patientSafeSession(session) : session });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: err.message || "Server error" });
  }
});

module.exports = router;



