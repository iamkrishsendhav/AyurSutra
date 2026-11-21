const User = require('../models/User');
const TherapySession = require('../models/TherapySession');
const TreatmentPlan = require('../models/TreatmentPlan');
const DoctorAssessment = require('../models/DoctorAssessment');

async function getAssignedPatients(practitionerId) {
  const patients = await User.find({ userType: 'patient', assignedPractitioner: practitionerId })
    .select('name email phone profileImageUrl address personalDetails createdAt updatedAt status')
    .sort({ updatedAt: -1 }).lean();
  const ids = patients.map((patient) => patient._id);
  if (!ids.length) return [];
  const [plans, sessions, assessedPatientIds] = await Promise.all([
    TreatmentPlan.find({ patient: { $in: ids } }).select('patient status title startDate createdAt approval generatedAt therapies').sort({ createdAt: -1 }).lean(),
    TherapySession.find({ patient: { $in: ids } }).select('patient sessionName therapyType date startTime status treatmentPlan').sort({ date: -1 }).lean(),
    DoctorAssessment.distinct('patient', { patient: { $in: ids } }),
  ]);
  const assessed = new Set(assessedPatientIds.map(String));
  return patients.map((patient) => {
    const patientPlans = plans.filter((plan) => String(plan.patient) === String(patient._id));
    const latestPlan = patientPlans[0] || null;
    const activePlan = latestPlan && ['approved', 'pending-approval', 'draft'].includes(latestPlan.status) ? latestPlan : null;
    const patientSessions = sessions.filter((session) => String(session.patient) === String(patient._id));
    const upcoming = patientSessions.filter((session) => ['scheduled', 'confirmed'].includes(session.status) && new Date(session.date) >= new Date(new Date().setUTCHours(0, 0, 0, 0))).sort((a, b) => new Date(a.date) - new Date(b.date));
    const lastVisit = patientSessions.filter((session) => session.status === 'completed').sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    return {
      ...patient,
      activePlan: activePlan ? { _id: activePlan._id, title: activePlan.title, status: activePlan.status, startDate: activePlan.startDate, createdAt: activePlan.createdAt, generatedAt: activePlan.generatedAt, plannedSessions: (activePlan.therapies || []).reduce((sum, item) => sum + Number(item.occurrences || 0), 0) } : null,
      treatmentStatus: latestPlan?.status || (assessed.has(String(patient._id)) ? 'assessment-complete' : 'no-assessment'),
      assessmentPending: !assessed.has(String(patient._id)),
      nextSession: upcoming[0] || null,
      completedSessions: patientSessions.filter((session) => session.status === 'completed').length,
      generatedSessions: patientSessions.filter((session) => session.treatmentPlan).length,
      pendingSessions: patientSessions.filter((session) => ['scheduled', 'confirmed', 'in-progress'].includes(session.status)).length,
      lastVisit: lastVisit?.date || null,
      lastActivity: [lastVisit?.date, activePlan?.createdAt, patient.updatedAt].filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || patient.createdAt,
    };
  });
}

module.exports = { getAssignedPatients };
