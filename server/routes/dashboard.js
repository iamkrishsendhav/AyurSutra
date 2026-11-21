const express = require("express");
const router = express.Router();
const TherapySession = require("../models/TherapySession");
const User = require("../models/User");
const auth = require("../middleware/auth");
const Message = require("../models/Message");
const Notification = require("../models/Notification");
const TreatmentPlan = require("../models/TreatmentPlan");
const DoctorAssessment = require("../models/DoctorAssessment");
const PatientFollowUp = require("../models/PatientFollowUp");
const { getAssignedPatients } = require('../utils/practitionerPatients');

const isConsultationSession = (session) => !session.treatmentPlan && (
  ['Clinic Appointment', 'General Slot', 'Consultation Slot'].includes(session.sessionName) ||
  ['Custom', 'Consultation', 'General Consultation'].includes(session.therapyType)
);

// -------------------- PATIENT DASHBOARD --------------------
router.get("/patient", auth, async (req, res) => {
  try {
    const patientId = req.user._id;

    // Get patient with assigned practitioner
    const patient = await User.findById(patientId).populate('assignedPractitioner', 'name email practiceLocation practiceAreas consultationFee bio experience profileImageUrl qualifications availabilitySchedule');

    // Find sessions booked by this patient
    if (!patient || patient.userType !== "patient") return res.status(404).json({ message: "Patient not found" });
    const [sessions, plans, assessmentCount, followUps, latestNotifications, unreadMessages] = await Promise.all([
      TherapySession.find({ patient: patientId }).populate('practitioner', 'name practiceLocation').sort({ date: 1, startTime: 1 }).lean(),
      TreatmentPlan.find({ patient: patientId }).sort({ createdAt: -1 }).lean(),
      DoctorAssessment.countDocuments({ patient: patientId }),
      PatientFollowUp.find({ patient: patientId }).populate('practitioner', 'name').populate('session', 'sessionName therapyType date startTime').sort({ dueAt: 1 }).limit(20).lean(),
      Notification.find({ user: patientId }).sort({ scheduledAt: -1 }).limit(5).select('type payload read scheduledAt').lean(),
      Message.countDocuments({ to: patientId, read: false }),
    ]);
    const now = new Date();
    const therapySessions = sessions.filter((session) => !isConsultationSession(session));
    const completed = therapySessions.filter((session) => session.status === 'completed').length;
    const total = therapySessions.length;
    const cancelled = therapySessions.filter((session) => session.status === 'cancelled').length;
    const upcomingSessions = sessions.filter((session) => ['scheduled', 'confirmed'].includes(session.status) && new Date(session.date) >= new Date(now.setHours(0, 0, 0, 0))).sort((a, b) => new Date(a.date) - new Date(b.date));
    const therapyUpcoming = upcomingSessions.filter((session) => !isConsultationSession(session));
    const consultationUpcoming = upcomingSessions.filter(isConsultationSession);
    const patientSessionView = (session) => session ? {
      _id: session._id, therapyType: session.therapyType, sessionName: session.sessionName, phase: session.phase,
      date: session.date, startTime: session.startTime, durationMins: session.durationMins, status: session.status,
      practitioner: session.practitioner, therapySnapshot: session.therapySnapshot, statusHistory: session.statusHistory,
      clinicalRecord: session.clinicalRecord ? { actualStartedAt: session.clinicalRecord.actualStartedAt, actualCompletedAt: session.clinicalRecord.actualCompletedAt, actualDurationMins: session.clinicalRecord.actualDurationMins } : undefined,
    } : null;
    const activePlan = plans.find((plan) => ['approved', 'pending-approval', 'draft'].includes(plan.status)) || null;
    const approvedPlans = plans.filter((plan) => plan.status === 'approved');
    const plannedSessions = approvedPlans.reduce((sum, plan) => sum + (plan.therapies || []).reduce((therapySum, therapy) => therapySum + Number(therapy.occurrences || 0), 0), 0);
    const profileFields = [patient.name, patient.phone, patient.personalDetails?.dateOfBirth, patient.personalDetails?.gender, patient.address?.city, patient.address?.state, patient.medicalHistory?.conditions?.length || patient.medicalHistory?.healthNotes, patient.emergencyContact?.name];
    const profileCompletion = Math.round(profileFields.filter(Boolean).length / profileFields.length * 100);
    const planSummary = activePlan ? {
      _id: activePlan._id,
      status: activePlan.status,
      startDate: activePlan.startDate,
      approval: activePlan.approval,
      therapies: (activePlan.therapies || []).map(({ therapyType, sessionName, phase, occurrences, frequencyDays, durationMins, instructions, catalogSnapshot }) => ({ therapyType, sessionName, phase, occurrences, frequencyDays, durationMins: catalogSnapshot?.durationMins || durationMins, instructions, catalogSnapshot })),
      plannedSessions: (activePlan.therapies || []).reduce((sum, therapy) => sum + Number(therapy.occurrences || 0), 0),
      generatedAt: activePlan.generatedAt,
    } : null;

    res.json({
      completed,
      total,
      progress: total > 0 ? Math.round((completed / total) * 100) : null,
      wellnessScore: patient.wellnessScore > 0 ? patient.wellnessScore : null,
      nextSession: patientSessionView(therapyUpcoming[0]),
      nextConsultation: consultationUpcoming[0] ? { _id: consultationUpcoming[0]._id, date: consultationUpcoming[0].date, startTime: consultationUpcoming[0].startTime, status: consultationUpcoming[0].status, practitioner: consultationUpcoming[0].practitioner } : null,
      upcomingSessions: therapyUpcoming.slice(0, 5).map(patientSessionView),
      sessionCounts: { planned: plannedSessions, generated: total, completed, upcoming: therapyUpcoming.length, cancelled, remainingToGenerate: Math.max(plannedSessions - total, 0) },
      activePlan: planSummary,
      planStatus: activePlan?.status || (plans.length ? plans[0].status : null),
      planCount: plans.length,
      assessmentCount,
      followUps: followUps.map(({ _id, dueAt, notes, status, practitioner, session, treatmentPlan }) => ({ _id, dueAt, notes, status, practitioner, session, treatmentPlan })),
      latestNotifications: latestNotifications.map(({ _id, type, payload, read, scheduledAt }) => ({ _id, type, title: payload?.title || type?.replaceAll('-', ' '), message: payload?.body || '', read, scheduledAt })),
      profileCompletion,
      nextMilestone: patient.progressHistory?.length ? patient.currentStage : null,
      assignedPractitioner: patient.assignedPractitioner,
      hasPractitioner: !!patient.assignedPractitioner,
      notifications: await Notification.countDocuments({ user: patientId, read: false }),
      unreadMessages,
      doshaAssessment: null,
    });
  } catch (err) {
    console.error("Patient dashboard error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// -------------------- PRACTITIONER DASHBOARD --------------------
router.get("/practitioner/:id", auth, async (req, res) => {
  try {
    const practitionerId = req.params.id;
    const isAdmin = req.user.userType === 'admin';
    if (req.user.userType !== 'practitioner' && !isAdmin) return res.status(403).json({ message: 'Practitioner access required' });
    if (!isAdmin && String(req.user._id) !== String(practitionerId)) return res.status(403).json({ message: 'Practitioners may only view their own dashboard' });

    const assignedPatients = await getAssignedPatients(practitionerId);
    const patientIds = assignedPatients.map((patient) => patient._id);
    const [appointments, plans, assessedPatientIds, followUps, notifications, unreadNotifications] = await Promise.all([
      TherapySession.find({ practitioner: practitionerId, patient: { $ne: null } }).populate('patient', 'name email phone profileImageUrl').populate('treatmentPlan', 'status startDate therapies').sort({ date: 1, startTime: 1 }).lean(),
      TreatmentPlan.find({ patient: { $in: patientIds } }).select('patient status').lean(),
      DoctorAssessment.distinct('patient', { patient: { $in: patientIds } }),
      PatientFollowUp.find({ practitioner: practitionerId }).populate('patient', 'name email').sort({ dueAt: 1 }).limit(100).lean(),
      Notification.find({ user: practitionerId }).sort({ scheduledAt: -1 }).limit(8).select('type payload read scheduledAt').lean(),
      Notification.countDocuments({ user: practitionerId, read: false }),
    ]);
    const now = new Date();
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dayEnd = new Date(dayStart); dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
    const upcomingSessions = appointments.filter((session) => ['scheduled', 'confirmed'].includes(session.status) && new Date(session.date) >= dayStart).sort((a, b) => new Date(a.date) - new Date(b.date) || String(a.startTime).localeCompare(String(b.startTime)));
    const todaySessions = appointments.filter((session) => new Date(session.date) >= dayStart && new Date(session.date) < dayEnd).sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
    const nonCancelled = appointments.filter((session) => session.status !== 'cancelled');
    const completedSessions = appointments.filter((session) => session.status === 'completed').length;
    const todayFollowUps = followUps.filter((item) => item.status === 'pending' && new Date(item.dueAt) < dayEnd);
    const pendingPlans = plans.filter((plan) => ['draft', 'pending-approval'].includes(plan.status));
    const activePlans = plans.filter((plan) => plan.status === 'approved');
    const pendingAssessmentCount = patientIds.filter((id) => !assessedPatientIds.some((assessedId) => String(assessedId) === String(id))).length;
    res.json({
      totalPatients: assignedPatients.length,
      assignedPatients,
      upcomingSessions,
      todaySessions,
      todayAppointments: todaySessions.filter((session) => session.status !== 'cancelled').length,
      upcomingAppointments: upcomingSessions.length,
      todayTherapySessions: todaySessions.filter((session) => session.status !== 'cancelled' && Boolean(session.treatmentPlan)).length,
      totalSessions: appointments.length,
      completedSessions,
      inProgressSessions: appointments.filter((session) => session.status === 'in-progress').length,
      completionRate: nonCancelled.length ? Math.round(completedSessions / nonCancelled.length * 100) : null,
      pendingAssessments: pendingAssessmentCount,
      pendingTreatmentPlans: pendingPlans.length,
      activeTreatmentPlans: activePlans.length,
      followUpsDue: todayFollowUps.length,
      overdueFollowUps: followUps.filter((item) => item.status === 'pending' && new Date(item.dueAt) < dayStart).length,
      followUps,
      notifications,
      unreadNotifications,
      hasAssignedPatients: assignedPatients.length > 0,
      lastUpdated: new Date(),
    });
  } catch (err) {
    console.error("Practitioner dashboard error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
