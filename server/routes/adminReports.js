const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const User = require('../models/User');
const TherapySession = require('../models/TherapySession');
const TreatmentPlan = require('../models/TreatmentPlan');
const DoctorAssessment = require('../models/DoctorAssessment');
const PatientFollowUp = require('../models/PatientFollowUp');
const TherapyCatalogueItem = require('../models/TherapyCatalogueItem');

const router = express.Router();
router.use(auth, (req, res, next) => req.user.userType === 'admin' ? next() : res.status(403).json({ message: 'Admin access required' }));

function readRange(query) {
  const parse = (value, fallback) => {
    if (!value) return fallback;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };
  const now = new Date(); const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const defaultTo = new Date(today); const defaultFrom = new Date(today); defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 29);
  const from = parse(query.from, defaultFrom); const toDate = parse(query.to, defaultTo);
  if (!from || !toDate || from > toDate) return null;
  const to = new Date(toDate); to.setUTCDate(to.getUTCDate() + 1);
  const lengthDays = Math.ceil((to - from) / 86400000);
  if (lengthDays > 731) return null;
  const previousFrom = new Date(from); previousFrom.setUTCDate(previousFrom.getUTCDate() - lengthDays);
  return { from, to, previousFrom, previousTo: from, lengthDays };
}

function sessionFilter(req, range) {
  const filter = { date: { $gte: range.from, $lt: range.to } };
  if (req.query.status && req.query.status !== 'all') {
    if (!['scheduled', 'confirmed', 'in-progress', 'completed', 'cancelled'].includes(req.query.status)) return null;
    filter.status = req.query.status;
  }
  if (req.query.practitionerId) {
    if (!mongoose.isValidObjectId(req.query.practitionerId)) return null;
    filter.practitioner = req.query.practitionerId;
  }
  if (req.query.therapy && req.query.therapy !== 'all') {
    if (typeof req.query.therapy !== 'string' || req.query.therapy.length > 120) return null;
    const escaped = req.query.therapy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ therapyType: new RegExp(`^${escaped}$`, 'i') }, { 'therapySnapshot.name': new RegExp(`^${escaped}$`, 'i') }];
  }
  return filter;
}

const count = (Model, filter) => Model.countDocuments(filter);

router.get('/analytics', async (req, res) => {
  try {
    const range = readRange(req.query); if (!range) return res.status(400).json({ message: 'Use a valid date range no longer than 731 days' });
    const sessions = sessionFilter(req, range); if (!sessions) return res.status(400).json({ message: 'Invalid status, therapy or practitioner filter' });
    const previousSessions = { ...sessions, date: { $gte: range.previousFrom, $lt: range.previousTo } };
    const patientPeriod = { userType: 'patient', createdAt: { $gte: range.from, $lt: range.to } };
    const previousPatients = { userType: 'patient', createdAt: { $gte: range.previousFrom, $lt: range.previousTo } };
    const planPeriod = { createdAt: { $gte: range.from, $lt: range.to } };
    const previousPlanPeriod = { createdAt: { $gte: range.previousFrom, $lt: range.previousTo } };
    const followupPeriod = { createdAt: { $gte: range.from, $lt: range.to } };
    const previousFollowupPeriod = { createdAt: { $gte: range.previousFrom, $lt: range.previousTo } };
    const rescheduleFilter = { ...sessions }; delete rescheduleFilter.date;
    const [totalPatients, newPatients, priorNewPatients, activePractitioners, accountCounts, currentSessionTotals, priorSessionTotals, plansByStatus, planIds, plannedPlans, followUpsByStatus, trends, therapyUsage, practitionerSessionTotals, rescheduleStats] = await Promise.all([
      User.countDocuments({ userType: 'patient' }),
      count(User, patientPeriod), count(User, previousPatients),
      User.countDocuments({ userType: 'practitioner', professionalStatus: { $ne: 'inactive' }, accountStatus: { $ne: 'suspended' } }),
      User.aggregate([
        { $match: { userType: 'patient' } },
        { $group: { _id: { $cond: [{ $eq: ['$accountStatus', 'suspended'] }, 'inactive', 'active'] }, count: { $sum: 1 } } },
      ]),
      TherapySession.aggregate([{ $match: sessions }, { $group: { _id: null, total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } }, cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } }, upcoming: { $sum: { $cond: [{ $and: [{ $in: ['$status', ['scheduled', 'confirmed']] }, { $gte: ['$date', new Date()] }] }, 1, 0] } } } }]),
      TherapySession.aggregate([{ $match: previousSessions }, { $group: { _id: null, total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } }, cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } } } }]),
      TreatmentPlan.aggregate([{ $match: planPeriod }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      TreatmentPlan.find(planPeriod).select('_id status therapies.occurrences generatedAt').lean(),
      TreatmentPlan.find(planPeriod).select('status therapies.catalogTherapy therapies.catalogSnapshot therapies.therapyType therapies.occurrences').lean(),
      PatientFollowUp.aggregate([{ $match: followupPeriod }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      buildTrends(sessions, patientPeriod, range, req.query.bucket),
      TherapySession.aggregate([{ $match: sessions }, { $group: { _id: { $ifNull: ['$therapySnapshot.name', '$therapyType'] }, sessions: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } }, cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } }, durationTotal: { $sum: { $cond: [{ $gt: ['$clinicalRecord.actualDurationMins', 0] }, '$clinicalRecord.actualDurationMins', 0] } }, durationCount: { $sum: { $cond: [{ $gt: ['$clinicalRecord.actualDurationMins', 0] }, 1, 0] } } } }, { $sort: { sessions: -1 } }, { $limit: 100 }]),
      TherapySession.aggregate([{ $match: sessions }, { $group: { _id: '$practitioner', total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } }, cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } }, upcoming: { $sum: { $cond: [{ $and: [{ $in: ['$status', ['scheduled', 'confirmed']] }, { $gte: ['$date', new Date()] }] }, 1, 0] } } } }]),
      TherapySession.aggregate([{ $match: { ...rescheduleFilter, scheduleHistory: { $elemMatch: { changedAt: { $gte: range.from, $lt: range.to } } } } }, { $unwind: '$scheduleHistory' }, { $match: { 'scheduleHistory.changedAt': { $gte: range.from, $lt: range.to } } }, { $group: { _id: null, count: { $sum: 1 } } }]),
    ]);
    const planSessions = plannedPlans.reduce((sum, plan) => sum + (plan.status === 'approved' ? plan.therapies.reduce((inner, item) => inner + Number(item.occurrences || 0), 0) : 0), 0);
    const generatedPlanIds = planIds.filter((plan) => plan.generatedAt).map((plan) => plan._id);
    const [generatedSessionCount, completedGeneratedSessionCount, cancelledGeneratedSessionCount, previousPlanCount, previousFollowupCount] = await Promise.all([
      generatedPlanIds.length ? TherapySession.countDocuments({ treatmentPlan: { $in: generatedPlanIds } }) : 0,
      generatedPlanIds.length ? TherapySession.countDocuments({ treatmentPlan: { $in: generatedPlanIds }, status: 'completed' }) : 0,
      generatedPlanIds.length ? TherapySession.countDocuments({ treatmentPlan: { $in: generatedPlanIds }, status: 'cancelled' }) : 0,
      count(TreatmentPlan, previousPlanPeriod), count(PatientFollowUp, previousFollowupPeriod),
    ]);
    const practitionerIds = practitionerSessionTotals.map((item) => item._id).filter(Boolean);
    const practitioners = practitionerIds.length ? await User.find({ _id: { $in: practitionerIds } }).select('name email professionalStatus availabilitySchedule').lean() : [];
    const assignedCounts = practitionerIds.length ? await User.aggregate([{ $match: { userType: 'patient', assignedPractitioner: { $in: practitionerIds } } }, { $group: { _id: '$assignedPractitioner', count: { $sum: 1 } } }]) : [];
    const assignedMap = new Map(assignedCounts.map((item) => [String(item._id), item.count])); const practitionerMap = new Map(practitioners.map((item) => [String(item._id), item]));
    const workload = practitionerSessionTotals.map((item) => ({ practitioner: practitionerMap.get(String(item._id)) || null, assignedPatientCount: assignedMap.get(String(item._id)) || 0, totalSessions: item.total, completedSessions: item.completed, cancelledSessions: item.cancelled, upcomingSessions: item.upcoming }));
    const totals = currentSessionTotals[0] || { total: 0, completed: 0, cancelled: 0, upcoming: 0 }; const prior = priorSessionTotals[0] || { total: 0, completed: 0, cancelled: 0 };
    const distribution = await TherapySession.aggregate([{ $match: sessions }, { $group: { _id: '$status', count: { $sum: 1 } } }]);
    const followups = Object.fromEntries(followUpsByStatus.map((item) => [item._id, item.count]));
    const status = Object.fromEntries(plansByStatus.map((item) => [item._id, item.count]));
    const plannedByTherapy = new Map(); for (const plan of plannedPlans) for (const item of plan.therapies || []) { const name = item.catalogSnapshot?.name || item.therapyType; const entry = plannedByTherapy.get(name) || { planned: 0, approvedPlanned: 0 }; entry.planned += Number(item.occurrences || 0); if (plan.status === 'approved') entry.approvedPlanned += Number(item.occurrences || 0); plannedByTherapy.set(name, entry); }
    const therapyAnalytics = therapyUsage.map((item) => ({ therapy: item._id || 'Unspecified', sessions: item.sessions, completed: item.completed, cancelled: item.cancelled, planned: plannedByTherapy.get(item._id)?.planned || 0, approvedPlanned: plannedByTherapy.get(item._id)?.approvedPlanned || 0, averageActualDurationMins: item.durationCount ? Math.round(item.durationTotal / item.durationCount) : null }));
    const metric = (current, previous) => ({ current, previous, changePercent: previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null });
    res.json({ range: { from: range.from, to: new Date(range.to.getTime() - 1), previousFrom: range.previousFrom, previousTo: new Date(range.previousTo.getTime() - 1), bucket: req.query.bucket === 'month' || range.lengthDays > 120 ? 'month' : 'day' }, metrics: { totalPatients, activePractitioners, newPatients: metric(newPatients, priorNewPatients), totalSessions: metric(totals.total, prior.total), completedSessions: metric(totals.completed, prior.completed), cancelledSessions: metric(totals.cancelled, prior.cancelled), upcomingSessions: totals.upcoming, plansByStatus: status, plansCreated: metric(Object.values(status).reduce((a, b) => a + b, 0), previousPlanCount), followUpsByStatus: followups, followUpsCreated: metric(Object.values(followups).reduce((a, b) => a + b, 0), previousFollowupCount), accounts: Object.fromEntries(accountCounts.map((item) => [item._id, item.count])), plannedSessions: planSessions, generatedSessions: generatedSessionCount, completedGeneratedSessions: completedGeneratedSessionCount, cancelledGeneratedSessions: cancelledGeneratedSessionCount, remainingToGenerate: Math.max(0, planSessions - generatedSessionCount), remainingPlannedSessions: Math.max(0, planSessions - completedGeneratedSessionCount), generatedNotCompleted: Math.max(0, generatedSessionCount - completedGeneratedSessionCount - cancelledGeneratedSessionCount) }, trends, statusDistribution: Object.fromEntries(distribution.map((item) => [item._id, item.count])), therapyAnalytics, practitionerWorkload: workload, rescheduleCount: rescheduleStats[0]?.count || 0 });
  } catch (error) { console.error('Report analytics failed:', error); res.status(500).json({ message: 'Unable to calculate reports' }); }
});

async function buildTrends(sessionMatch, patientPeriod, range, requestedBucket) {
  const bucket = requestedBucket === 'month' || range.lengthDays > 120 ? 'month' : 'day';
  const format = bucket === 'month' ? '%Y-%m' : '%Y-%m-%d';
  const [sessionTrends, patientTrends] = await Promise.all([
    TherapySession.aggregate([{ $match: sessionMatch }, { $group: { _id: { $dateToString: { format, date: '$date', timezone: 'UTC' } }, total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } }, cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } } } }, { $sort: { _id: 1 } }]),
    User.aggregate([{ $match: patientPeriod }, { $group: { _id: { $dateToString: { format, date: '$createdAt', timezone: 'UTC' } }, registrations: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
  ]);
  const patientMap = new Map(patientTrends.map((item) => [item._id, item.registrations]));
  return { bucket, appointments: sessionTrends.map((item) => ({ date: item._id, total: item.total, completed: item.completed, cancelled: item.cancelled })), patientRegistrations: sessionTrends.map((item) => ({ date: item._id, registrations: patientMap.get(item._id) || 0 })).concat(patientTrends.filter((item) => !sessionTrends.some((session) => session._id === item._id)).map((item) => ({ date: item._id, registrations: item.registrations }))).sort((a, b) => a.date.localeCompare(b.date)) };
}

router.get('/patients', async (req, res) => {
  try {
    const range = readRange(req.query); if (!range) return res.status(400).json({ message: 'Invalid date range' });
    const q = req.query.q || ''; if (typeof q !== 'string' || q.length > 120) return res.status(400).json({ message: 'Search query is too long' });
    const filter = { userType: 'patient' };
    if (req.query.accountStatus === 'active') filter.accountStatus = { $in: ['active', null] };
    else if (req.query.accountStatus === 'inactive') filter.accountStatus = 'suspended';
    else if (req.query.accountStatus && req.query.accountStatus !== 'all') return res.status(400).json({ message: 'Invalid account status filter' });
    if (q.trim()) { const matcher = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); filter.$or = [{ name: matcher }, { email: matcher }, { phone: matcher }]; }
    const patients = await User.find(filter).select('name email phone accountStatus createdAt assignedPractitioner').populate('assignedPractitioner', 'name email').sort({ createdAt: -1 }).limit(500).lean();
    const patientIds = patients.map((item) => item._id);
    const [sessions, plans, followups] = await Promise.all([
      TherapySession.aggregate([{ $match: { patient: { $in: patientIds } } }, { $group: { _id: '$patient', total: { $sum: { $cond: [{ $ne: ['$status', 'cancelled'] }, 1, 0] } }, completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } }, upcoming: { $sum: { $cond: [{ $and: [{ $in: ['$status', ['scheduled', 'confirmed']] }, { $gte: ['$date', new Date()] }] }, 1, 0] } } } }]),
      TreatmentPlan.aggregate([{ $match: { patient: { $in: patientIds } } }, { $group: { _id: '$patient', count: { $sum: 1 }, approved: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } } } }]),
      PatientFollowUp.aggregate([{ $match: { patient: { $in: patientIds } } }, { $group: { _id: '$patient', pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } }, completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } } } }]),
    ]);
    const map = (list) => new Map(list.map((item) => [String(item._id), item])); const sessionMap = map(sessions); const planMap = map(plans); const followMap = map(followups);
    res.json({ patients: patients.map((patient) => { const s = sessionMap.get(String(patient._id)) || {}; const p = planMap.get(String(patient._id)) || {}; const f = followMap.get(String(patient._id)) || {}; return { ...patient, sessionTotals: { total: s.total || 0, completed: s.completed || 0, remaining: Math.max(0, (s.total || 0) - (s.completed || 0)), upcoming: s.upcoming || 0 }, planTotals: { total: p.count || 0, approved: p.approved || 0 }, followUpTotals: { pending: f.pending || 0, completed: f.completed || 0 } }; }) });
  } catch (error) { console.error('Patient analytics failed:', error); res.status(500).json({ message: 'Unable to load patient analytics' }); }
});

router.get('/patients/:patientId', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.patientId)) return res.status(400).json({ message: 'Invalid patient id' });
    const patient = await User.findOne({ _id: req.params.patientId, userType: 'patient' }).select('name email phone accountStatus createdAt assignedPractitioner').populate('assignedPractitioner', 'name email').lean();
    if (!patient) return res.status(404).json({ message: 'Patient not found' });
    const [assessments, plans, sessions, followUps] = await Promise.all([
      DoctorAssessment.find({ patient: patient._id }).populate('doctor', 'name').sort({ assessedAt: -1 }).limit(100).select('assessedAt symptoms diagnosis recommendations doctor').lean(),
      TreatmentPlan.find({ patient: patient._id }).populate('doctor', 'name').sort({ createdAt: -1 }).limit(100).select('status startDate therapies generatedAt doctor approval').lean(),
      TherapySession.find({ patient: patient._id }).populate('practitioner', 'name').sort({ date: -1, startTime: -1 }).limit(300).select('therapyType therapySnapshot sessionName phase date startTime durationMins status clinicalRecord.actualDurationMins feedback.wellness feedback.comments feedback.submittedAt').lean(),
      PatientFollowUp.find({ patient: patient._id }).populate('practitioner', 'name').populate('session', 'therapyType sessionName date').sort({ dueAt: -1 }).limit(100).select('dueAt notes status completedAt practitioner session treatmentPlan').lean(),
    ]);
    res.json({ patient: { _id: patient._id, name: patient.name, email: patient.email, phone: patient.phone, accountStatus: patient.accountStatus || 'active', createdAt: patient.createdAt, assignedPractitioner: patient.assignedPractitioner }, assessments, plans, sessions, followUps });
  } catch (error) { console.error('Patient report failed:', error); res.status(500).json({ message: 'Unable to load patient report' }); }
});

router.get('/practitioners', async (req, res) => {
  try {
    const range = readRange(req.query); if (!range) return res.status(400).json({ message: 'Invalid date range' });
    const q = req.query.q || ''; if (typeof q !== 'string' || q.length > 120) return res.status(400).json({ message: 'Search query is too long' });
    const filter = { userType: 'practitioner' };
    if (q.trim()) { const matcher = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); filter.$or = [{ name: matcher }, { email: matcher }, { practiceAreas: matcher }]; }
    const practitioners = await User.find(filter).select('name email phone profileImageUrl qualifications practiceAreas experience professionalStatus availabilitySchedule availableForNewPatients verificationStatus').sort({ name: 1 }).limit(500).lean();
    const ids = practitioners.map((item) => item._id);
    const [patients, sessions] = await Promise.all([
      User.aggregate([{ $match: { userType: 'patient', assignedPractitioner: { $in: ids } } }, { $group: { _id: '$assignedPractitioner', count: { $sum: 1 } } }]),
      TherapySession.aggregate([{ $match: { practitioner: { $in: ids }, date: { $gte: range.from, $lt: range.to } } }, { $group: { _id: '$practitioner', total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } }, cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } }, upcoming: { $sum: { $cond: [{ $and: [{ $in: ['$status', ['scheduled', 'confirmed']] }, { $gte: ['$date', new Date()] }] }, 1, 0] } } } }]),
    ]);
    const patientMap = new Map(patients.map((item) => [String(item._id), item.count])); const sessionMap = new Map(sessions.map((item) => [String(item._id), item]));
    res.json({ practitioners: practitioners.map((item) => { const s = sessionMap.get(String(item._id)) || {}; return { ...item, assignedPatientCount: patientMap.get(String(item._id)) || 0, totalSessions: s.total || 0, completedSessions: s.completed || 0, cancelledSessions: s.cancelled || 0, upcomingSessions: s.upcoming || 0 }; }) });
  } catch (error) { console.error('Practitioner analytics failed:', error); res.status(500).json({ message: 'Unable to load practitioner analytics' }); }
});

router.get('/practitioners/:practitionerId', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.practitionerId)) return res.status(400).json({ message: 'Invalid practitioner id' });
    const range = readRange(req.query); if (!range) return res.status(400).json({ message: 'Invalid date range' });
    const practitioner = await User.findOne({ _id: req.params.practitionerId, userType: 'practitioner' }).select('name email phone profileImageUrl qualifications practiceAreas experience professionalStatus availabilitySchedule availableForNewPatients verificationStatus practiceLocation').lean();
    if (!practitioner) return res.status(404).json({ message: 'Practitioner not found' });
    const [patients, sessions] = await Promise.all([
      User.find({ userType: 'patient', assignedPractitioner: practitioner._id }).select('name email phone accountStatus').sort({ name: 1 }).limit(500).lean(),
      TherapySession.find({ practitioner: practitioner._id, date: { $gte: range.from, $lt: range.to } }).populate('patient', 'name email').sort({ date: 1, startTime: 1 }).limit(1000).lean(),
    ]);
    res.json({ practitioner, patients, sessions });
  } catch (error) { console.error('Practitioner report failed:', error); res.status(500).json({ message: 'Unable to load practitioner report' }); }
});

router.get('/therapies', async (req, res) => {
  try {
    const range = readRange(req.query); if (!range) return res.status(400).json({ message: 'Invalid date range' });
    const [catalogue, sessions, plans] = await Promise.all([
      TherapyCatalogueItem.find({}).sort({ category: 1, name: 1 }).limit(500).lean(),
      TherapySession.aggregate([{ $match: { date: { $gte: range.from, $lt: range.to } } }, { $group: { _id: { $ifNull: ['$therapySnapshot.name', '$therapyType'] }, sessions: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } }, durationTotal: { $sum: { $cond: [{ $gt: ['$clinicalRecord.actualDurationMins', 0] }, '$clinicalRecord.actualDurationMins', 0] } }, durationCount: { $sum: { $cond: [{ $gt: ['$clinicalRecord.actualDurationMins', 0] }, 1, 0] } } } }]),
      TreatmentPlan.aggregate([{ $match: { status: 'approved', createdAt: { $gte: range.from, $lt: range.to } } }, { $unwind: '$therapies' }, { $group: { _id: { $ifNull: ['$therapies.catalogSnapshot.name', '$therapies.therapyType'] }, planned: { $sum: '$therapies.occurrences' } } }]),
    ]);
    const sessionMap = new Map(sessions.map((item) => [item._id, item])); const planMap = new Map(plans.map((item) => [item._id, item.planned]));
    const entries = new Map();
    for (const therapy of catalogue) { const session = sessionMap.get(therapy.name) || {}; entries.set(therapy.name, { _id: therapy._id, name: therapy.name, category: therapy.category, active: therapy.active, durationMins: therapy.durationMins, sessions: session.sessions || 0, completed: session.completed || 0, planned: planMap.get(therapy.name) || 0, averageActualDurationMins: session.durationCount ? Math.round(session.durationTotal / session.durationCount) : null }); }
    for (const [name, session] of sessionMap) if (!entries.has(name)) entries.set(name, { name, category: 'Legacy / uncatalogued', active: null, sessions: session.sessions, completed: session.completed, planned: planMap.get(name) || 0, averageActualDurationMins: session.durationCount ? Math.round(session.durationTotal / session.durationCount) : null });
    res.json({ therapies: [...entries.values()].sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name)) });
  } catch (error) { console.error('Therapy analytics failed:', error); res.status(500).json({ message: 'Unable to load therapy analytics' }); }
});

router.get('/plans', async (req, res) => {
  try {
    const range = readRange(req.query); if (!range) return res.status(400).json({ message: 'Invalid date range' });
    const status = req.query.status || 'all'; if (!['all', 'draft', 'pending-approval', 'approved', 'rejected'].includes(status)) return res.status(400).json({ message: 'Invalid plan status' });
    const filter = { createdAt: { $gte: range.from, $lt: range.to } }; if (status !== 'all') filter.status = status;
    const plans = await TreatmentPlan.find(filter).populate('patient', 'name email').populate('doctor', 'name email').populate('assessment', 'assessedAt').sort({ createdAt: -1 }).limit(1000).lean();
    const ids = plans.map((item) => item._id);
    const counts = ids.length ? await TherapySession.aggregate([{ $match: { treatmentPlan: { $in: ids } } }, { $group: { _id: '$treatmentPlan', generated: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } }, cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } } } }]) : [];
    const countMap = new Map(counts.map((item) => [String(item._id), item]));
    res.json({ plans: plans.map((plan) => { const countInfo = countMap.get(String(plan._id)) || {}; const planned = plan.status === 'approved' ? (plan.therapies || []).reduce((sum, item) => sum + Number(item.occurrences || 0), 0) : 0; return { ...plan, plannedSessionCount: planned, generatedSessionCount: countInfo.generated || 0, completedSessionCount: countInfo.completed || 0, cancelledSessionCount: countInfo.cancelled || 0, remainingToGenerate: Math.max(0, planned - (countInfo.generated || 0)), remainingPlannedSessionCount: Math.max(0, planned - (countInfo.completed || 0)), generatedNotCompleted: Math.max(0, (countInfo.generated || 0) - (countInfo.completed || 0) - (countInfo.cancelled || 0)) }; }) });
  } catch (error) { console.error('Treatment plan analytics failed:', error); res.status(500).json({ message: 'Unable to load treatment progress reports' }); }
});

router.get('/follow-ups', async (req, res) => {
  try {
    const range = readRange(req.query); if (!range) return res.status(400).json({ message: 'Invalid date range' });
    const followUps = await PatientFollowUp.find({ dueAt: { $gte: range.from, $lt: range.to } }).populate('patient', 'name email').populate('practitioner', 'name').populate('session', 'therapyType sessionName date').sort({ dueAt: 1 }).limit(1000).lean();
    res.json({ followUps });
  } catch (error) { console.error('Follow-up analytics failed:', error); res.status(500).json({ message: 'Unable to load follow-up reports' }); }
});

router.get('/export', async (req, res) => {
  try {
    const range = readRange(req.query); if (!range) return res.status(400).json({ message: 'Invalid date range' });
    const type = req.query.type;
    if (type === 'sessions') {
      const filter = sessionFilter(req, range); if (!filter) return res.status(400).json({ message: 'Invalid session filters' });
      const sessions = await TherapySession.find(filter).populate('patient', 'name email').populate('practitioner', 'name email').sort({ date: 1, startTime: 1 }).limit(10000).lean();
      return res.json({ columns: ['date', 'startTime', 'patientName', 'patientEmail', 'practitionerName', 'therapy', 'status', 'durationMins', 'actualDurationMins'], rows: sessions.map((item) => ({ date: item.date, startTime: item.startTime, patientName: item.patient?.name || '', patientEmail: item.patient?.email || '', practitionerName: item.practitioner?.name || '', therapy: item.therapySnapshot?.name || item.therapyType, status: item.status, durationMins: item.durationMins, actualDurationMins: item.clinicalRecord?.actualDurationMins ?? '' })) });
    }
    if (type === 'patients') {
      const body = await exportPatientRows(range); return res.json(body);
    }
    if (type === 'patient-report') {
      if (!mongoose.isValidObjectId(req.query.patientId)) return res.status(400).json({ message: 'A valid patient id is required' });
      const patient = await User.findOne({ _id: req.query.patientId, userType: 'patient' }).select('name email phone createdAt accountStatus').lean(); if (!patient) return res.status(404).json({ message: 'Patient not found' });
      const [assessments, sessions, plans, followups] = await Promise.all([DoctorAssessment.find({ patient: patient._id, assessedAt: { $gte: range.from, $lt: range.to } }).select('assessedAt diagnosis recommendations').sort({ assessedAt: -1 }).lean(), TherapySession.find({ patient: patient._id, date: { $gte: range.from, $lt: range.to } }).select('date startTime therapyType therapySnapshot.name status durationMins clinicalRecord.actualDurationMins feedback.wellness feedback.submittedAt').sort({ date: 1 }).lean(), TreatmentPlan.find({ patient: patient._id, createdAt: { $gte: range.from, $lt: range.to } }).select('status startDate therapies.therapyType therapies.occurrences generatedAt').lean(), PatientFollowUp.find({ patient: patient._id, dueAt: { $gte: range.from, $lt: range.to } }).select('dueAt status completedAt').lean()]);
      const rows = [
        ...assessments.map((item) => ({ section: 'Assessment', date: item.assessedAt, detail: item.diagnosis || 'Assessment recorded', status: '', value: item.recommendations || '' })),
        ...plans.map((item) => ({ section: 'Treatment plan', date: item.startDate, detail: item.therapies.map((t) => `${t.therapyType} (${t.occurrences} planned)`).join('; '), status: item.status, value: item.generatedAt ? 'Sessions generated' : '' })),
        ...sessions.map((item) => ({ section: 'Session', date: item.date, detail: `${item.startTime} · ${item.therapySnapshot?.name || item.therapyType}`, status: item.status, value: item.clinicalRecord?.actualDurationMins ?? '' })),
        ...followups.map((item) => ({ section: 'Follow-up', date: item.dueAt, detail: 'Follow-up record', status: item.status, value: item.completedAt || '' })),
      ].sort((a, b) => new Date(a.date) - new Date(b.date));
      return res.json({ patient: { name: patient.name, email: patient.email, phone: patient.phone, registeredAt: patient.createdAt, accountStatus: patient.accountStatus || 'active' }, columns: ['section', 'date', 'detail', 'status', 'value'], rows });
    }
    if (type === 'practitioners') {
      const list = await User.find({ userType: 'practitioner' }).select('name email phone qualifications practiceAreas experience professionalStatus availabilitySchedule').sort({ name: 1 }).limit(5000).lean();
      const ids = list.map((item) => item._id); const counts = ids.length ? await TherapySession.aggregate([{ $match: { practitioner: { $in: ids }, date: { $gte: range.from, $lt: range.to } } }, { $group: { _id: '$practitioner', total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } }, cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } } } }]) : []; const map = new Map(counts.map((item) => [String(item._id), item]));
      return res.json({ columns: ['name', 'email', 'phone', 'qualifications', 'skills', 'status', 'sessions', 'completed', 'cancelled'], rows: list.map((item) => { const c = map.get(String(item._id)) || {}; return { name: item.name, email: item.email, phone: item.phone, qualifications: (item.qualifications || []).join('; '), skills: (item.practiceAreas || []).join('; '), status: item.professionalStatus || 'active', sessions: c.total || 0, completed: c.completed || 0, cancelled: c.cancelled || 0 }; }) });
    }
    if (type === 'plans') {
      const plans = await TreatmentPlan.find({ createdAt: { $gte: range.from, $lt: range.to } }).populate('patient', 'name email').populate('doctor', 'name').sort({ createdAt: -1 }).limit(10000).lean();
      return res.json({ columns: ['patientName', 'patientEmail', 'practitioner', 'createdAt', 'status', 'therapies', 'plannedSessions', 'generated'], rows: plans.map((item) => ({ patientName: item.patient?.name || '', patientEmail: item.patient?.email || '', practitioner: item.doctor?.name || '', createdAt: item.createdAt, status: item.status, therapies: item.therapies.map((t) => t.therapyType).join('; '), plannedSessions: item.status === 'approved' ? item.therapies.reduce((sum, t) => sum + Number(t.occurrences || 0), 0) : 0, generated: Boolean(item.generatedAt) })) });
    }
    if (type === 'therapies') {
      const body = await routerTherapyReport(range); return res.json(body);
    }
    if (type === 'follow-ups') {
      const items = await PatientFollowUp.find({ dueAt: { $gte: range.from, $lt: range.to } }).populate('patient', 'name email').populate('practitioner', 'name').sort({ dueAt: 1 }).limit(10000).lean();
      return res.json({ columns: ['patientName', 'patientEmail', 'practitioner', 'dueAt', 'status', 'completedAt'], rows: items.map((item) => ({ patientName: item.patient?.name || '', patientEmail: item.patient?.email || '', practitioner: item.practitioner?.name || '', dueAt: item.dueAt, status: item.status, completedAt: item.completedAt || '' })) });
    }
    if (type === 'feedback') {
      const sessions = await TherapySession.find({ 'feedback.submittedAt': { $gte: range.from, $lt: range.to } }).populate('patient', 'name email').populate('practitioner', 'name').sort({ 'feedback.submittedAt': 1 }).limit(10000).lean();
      return res.json({ columns: ['patientName', 'patientEmail', 'practitioner', 'therapy', 'sessionDate', 'rating', 'submittedAt', 'comments'], rows: sessions.map((item) => ({ patientName: item.patient?.name || '', patientEmail: item.patient?.email || '', practitioner: item.practitioner?.name || '', therapy: item.therapySnapshot?.name || item.therapyType, sessionDate: item.date, rating: item.feedback?.wellness ?? '', submittedAt: item.feedback?.submittedAt, comments: item.feedback?.comments || '' })) });
    }
    return res.status(400).json({ message: 'Unsupported export type' });
  } catch (error) { console.error('Report export failed:', error); res.status(500).json({ message: 'Unable to prepare export' }); }
});

async function exportPatientRows(range) {
  const users = await User.find({ userType: 'patient', createdAt: { $gte: range.from, $lt: range.to } }).select('name email phone accountStatus createdAt assignedPractitioner').populate('assignedPractitioner', 'name').sort({ createdAt: -1 }).limit(10000).lean();
  const ids = users.map((item) => item._id); const [sessions, plans] = await Promise.all([
    TherapySession.aggregate([{ $match: { patient: { $in: ids }, date: { $gte: range.from, $lt: range.to } } }, { $group: { _id: '$patient', total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } } } }]),
    TreatmentPlan.aggregate([{ $match: { patient: { $in: ids }, createdAt: { $gte: range.from, $lt: range.to } } }, { $group: { _id: '$patient', total: { $sum: 1 } } }]),
  ]); const sm = new Map(sessions.map((item) => [String(item._id), item])); const pm = new Map(plans.map((item) => [String(item._id), item.total]));
  return { columns: ['name', 'email', 'phone', 'registeredAt', 'accountStatus', 'assignedPractitioner', 'sessionsInRange', 'completedSessionsInRange', 'plansCreatedInRange'], rows: users.map((item) => { const s = sm.get(String(item._id)) || {}; return { name: item.name, email: item.email, phone: item.phone, registeredAt: item.createdAt, accountStatus: item.accountStatus || 'active', assignedPractitioner: item.assignedPractitioner?.name || '', sessionsInRange: s.total || 0, completedSessionsInRange: s.completed || 0, plansCreatedInRange: pm.get(String(item._id)) || 0 }; }) };
}

async function routerTherapyReport(range) {
  const [catalogue, sessionStats] = await Promise.all([TherapyCatalogueItem.find({}).select('name category active durationMins').sort({ name: 1 }).lean(), TherapySession.aggregate([{ $match: { date: { $gte: range.from, $lt: range.to } } }, { $group: { _id: { $ifNull: ['$therapySnapshot.name', '$therapyType'] }, sessions: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } }, actualDurationTotal: { $sum: { $cond: [{ $gt: ['$clinicalRecord.actualDurationMins', 0] }, '$clinicalRecord.actualDurationMins', 0] } }, actualDurationCount: { $sum: { $cond: [{ $gt: ['$clinicalRecord.actualDurationMins', 0] }, 1, 0] } } } }])]);
  const map = new Map(sessionStats.map((item) => [item._id, item]));
  return { columns: ['therapy', 'category', 'active', 'catalogueDurationMins', 'sessions', 'completed', 'averageActualDurationMins'], rows: catalogue.map((item) => { const stats = map.get(item.name) || {}; return { therapy: item.name, category: item.category, active: item.active, catalogueDurationMins: item.durationMins, sessions: stats.sessions || 0, completed: stats.completed || 0, averageActualDurationMins: stats.actualDurationCount ? Math.round(stats.actualDurationTotal / stats.actualDurationCount) : '' }; }) };
}

module.exports = router;
