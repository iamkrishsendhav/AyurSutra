const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const User = require('../models/User');
const TherapySession = require('../models/TherapySession');
const TreatmentPlan = require('../models/TreatmentPlan');
const PatientFollowUp = require('../models/PatientFollowUp');
const TherapyCatalogueItem = require('../models/TherapyCatalogueItem');
const ClinicSettings = require('../models/ClinicSettings');

const router = express.Router();
router.use(auth, (req, res, next) => req.user.userType === 'admin' ? next() : res.status(403).json({ message: 'Admin access required' }));

router.get('/overview', async (_req, res) => {
  try {
    const now = new Date(); const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0); const tomorrow = new Date(todayStart); tomorrow.setDate(tomorrow.getDate() + 1);
    const upcomingCutoff = new Date(todayStart); upcomingCutoff.setDate(upcomingCutoff.getDate() + 14);
    const [totalPatients, activePractitioners, receptionistAccounts, todaysAppointments, upcomingAppointments, completedSessions, totalTherapySessions, cancelledSessions, pendingPlans, approvedPlans, activePlans, pendingFollowUps, overdueFollowUps, activeTherapies, statusCounts, todaysSessions, upcomingSessions, recentRegistrations, practitioners] = await Promise.all([
      User.countDocuments({ userType: 'patient' }),
      User.countDocuments({ userType: 'practitioner', verificationStatus: 'verified', professionalStatus: { $ne: 'inactive' }, accountStatus: { $ne: 'suspended' } }),
      User.countDocuments({ userType: 'receptionist', accountStatus: { $ne: 'suspended' } }),
      TherapySession.countDocuments({ date: { $gte: todayStart, $lt: tomorrow }, status: { $ne: 'cancelled' } }),
      TherapySession.countDocuments({ date: { $gte: todayStart }, status: { $in: ['scheduled', 'confirmed'] } }),
      TherapySession.countDocuments({ status: 'completed' }),
      TherapySession.countDocuments({}),
      TherapySession.countDocuments({ status: 'cancelled' }),
      TreatmentPlan.countDocuments({ status: 'pending-approval' }),
      TreatmentPlan.countDocuments({ status: 'approved' }),
      TreatmentPlan.countDocuments({ status: 'approved', generatedAt: { $exists: true } }),
      PatientFollowUp.countDocuments({ status: 'pending' }),
      PatientFollowUp.countDocuments({ status: 'pending', dueAt: { $lt: todayStart } }),
      TherapyCatalogueItem.countDocuments({ active: true }),
      TherapySession.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      TherapySession.find({ date: { $gte: todayStart, $lt: tomorrow } }).populate('patient', 'name').populate('practitioner', 'name').sort({ startTime: 1 }).limit(30).lean(),
      TherapySession.find({ date: { $gte: todayStart, $lte: upcomingCutoff }, status: { $in: ['scheduled', 'confirmed'] } }).populate('patient', 'name').populate('practitioner', 'name').sort({ date: 1, startTime: 1 }).limit(30).lean(),
      User.find({ userType: { $in: ['patient', 'practitioner', 'receptionist'] } }).select('name email userType accountStatus professionalStatus employeeId createdAt').sort({ createdAt: -1 }).limit(10).lean(),
      User.find({ userType: 'practitioner' }).select('name email professionalStatus practiceAreas').sort({ name: 1 }).limit(30).lean(),
    ]);
    const workload = await Promise.all(practitioners.map(async (person) => {
      const [patients, upcoming, completed] = await Promise.all([
        User.countDocuments({ userType: 'patient', assignedPractitioner: person._id }),
        TherapySession.countDocuments({ practitioner: person._id, status: { $in: ['scheduled', 'confirmed'] }, date: { $gte: todayStart } }),
        TherapySession.countDocuments({ practitioner: person._id, status: 'completed' }),
      ]);
      return { ...person, assignedPatientCount: patients, upcomingSessionCount: upcoming, completedSessionCount: completed };
    }));
    const statusDistribution = Object.fromEntries(statusCounts.map(({ _id, count }) => [_id || 'unknown', count]));
    res.json({ generatedAt: now, metrics: { totalPatients, activePractitioners, receptionistAccounts, todaysAppointments, upcomingAppointments, totalTherapySessions, completedSessions, cancelledSessions, pendingPlans, approvedPlans, activePlans, pendingFollowUps, overdueFollowUps, activeTherapies }, statusDistribution, todaysSessions, upcomingSessions, recentRegistrations, practitionerWorkload: workload });
  } catch (error) { console.error('Admin overview failed:', error); res.status(500).json({ message: 'Unable to load clinic overview' }); }
});

router.get('/plans', async (req, res) => {
  try {
    const status = req.query.status || 'all'; const q = req.query.q || '';
    if (!['all', 'draft', 'pending-approval', 'approved', 'rejected'].includes(status) || typeof q !== 'string' || q.length > 120) return res.status(400).json({ message: 'Invalid plan filters' });
    const planFilter = status === 'all' ? {} : { status };
    if (q.trim()) {
      const escaped = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); const matcher = new RegExp(escaped, 'i');
      const matchingUsers = await User.find({ $or: [{ name: matcher }, { email: matcher }] }).select('_id').lean();
      planFilter.$or = [{ patient: { $in: matchingUsers.map((item) => item._id) } }, { doctor: { $in: matchingUsers.map((item) => item._id) } }, { 'therapies.therapyType': matcher }];
    }
    const plans = await TreatmentPlan.find(planFilter).populate('patient', 'name email phone').populate('doctor', 'name email qualifications practiceAreas').populate('assessment', 'assessedAt symptoms observations diagnosis recommendations').sort({ updatedAt: -1 }).limit(500).lean();
    const filtered = plans;
    const counts = await TherapySession.aggregate([{ $match: { treatmentPlan: { $in: filtered.map((plan) => plan._id) } } }, { $group: { _id: '$treatmentPlan', count: { $sum: 1 } } }]);
    const countByPlan = new Map(counts.map((item) => [String(item._id), item.count]));
    res.json({ plans: filtered.map((plan) => ({ ...plan, generatedSessionCount: countByPlan.get(String(plan._id)) || 0 })) });
  } catch (error) { console.error('Admin plans view failed:', error); res.status(500).json({ message: 'Unable to load treatment plans' }); }
});

router.get('/feedback', async (req, res) => {
  try {
    const filter = { 'feedback.submittedAt': { $exists: true } };
    if (req.query.practitionerId) {
      if (!mongoose.isValidObjectId(req.query.practitionerId)) return res.status(400).json({ message: 'Invalid practitioner id' });
      filter.practitioner = req.query.practitionerId;
    }
    const sessions = await TherapySession.find(filter).populate('patient', 'name').populate('practitioner', 'name').sort({ 'feedback.submittedAt': -1 }).limit(300).select('patient practitioner therapyType sessionName date status feedback').lean();
    const groups = new Map();
    sessions.forEach((session) => {
      const key = String(session.practitioner?._id || 'unassigned'); const item = groups.get(key) || { practitioner: session.practitioner, count: 0, totalRating: 0 };
      item.count++; item.totalRating += Number(session.feedback?.wellness || 0); groups.set(key, item);
    });
    res.json({ feedback: sessions, practitionerSummaries: [...groups.values()].map((item) => ({ practitioner: item.practitioner, count: item.count, averageRating: item.count ? Math.round((item.totalRating / item.count) * 100) / 100 : null })) });
  } catch (error) { console.error('Admin feedback view failed:', error); res.status(500).json({ message: 'Unable to load feedback' }); }
});

router.get('/activity', async (_req, res) => {
  try {
    const [users, plans, sessions, followUps, settings] = await Promise.all([
      User.find({ accountStatusHistory: { $exists: true, $ne: [] } }).select('name accountStatusHistory').limit(500).lean(),
      TreatmentPlan.find({ reviewHistory: { $exists: true, $ne: [] } }).select('patient doctor reviewHistory').populate('patient', 'name').populate('doctor', 'name').limit(500).lean(),
      TherapySession.find({ $or: [{ statusHistory: { $exists: true, $ne: [] } }, { scheduleHistory: { $exists: true, $ne: [] } }] }).select('patient practitioner statusHistory scheduleHistory').populate('patient', 'name').populate('practitioner', 'name').limit(500).lean(),
      PatientFollowUp.find({ status: 'completed' }).select('patient practitioner dueAt completedAt completedBy').populate('patient', 'name').populate('practitioner', 'name').populate('completedBy', 'name userType').sort({ completedAt: -1 }).limit(200).lean(),
      ClinicSettings.findOne({ key: 'clinic' }).select('updatedAt updatedBy').populate('updatedBy', 'name userType').lean(),
    ]);
    const events = [];
    for (const user of users) for (const entry of user.accountStatusHistory || []) events.push({ type: 'account-status', at: entry.changedAt, actorId: entry.changedBy, summary: `${user.name} account marked ${entry.status}` });
    for (const plan of plans) for (const entry of plan.reviewHistory || []) events.push({ type: 'plan-review', at: entry.reviewedAt, actorId: entry.reviewedBy, summary: `Treatment plan for ${plan.patient?.name || 'patient'} ${entry.status} by ${entry.reviewedBy ? 'authorized reviewer' : 'reviewer'}` });
    for (const session of sessions) {
      for (const entry of session.statusHistory || []) events.push({ type: 'appointment-status', at: entry.changedAt, actorId: entry.changedBy, summary: `${session.patient?.name || 'Patient'} session marked ${entry.status}` });
      for (const entry of session.scheduleHistory || []) events.push({ type: 'appointment-rescheduled', at: entry.changedAt, actorId: entry.changedBy, summary: `${session.patient?.name || 'Patient'} appointment rescheduled` });
    }
    for (const item of followUps) if (item.completedAt) events.push({ type: 'follow-up-completed', at: item.completedAt, actorId: item.completedBy, summary: `Follow-up completed for ${item.patient?.name || 'patient'}` });
    if (settings?.updatedAt) events.push({ type: 'clinic-settings-updated', at: settings.updatedAt, actorId: settings.updatedBy?._id, summary: 'Clinic operational settings updated' });
    const actorIds = [...new Set(events.map((event) => String(event.actorId || '')).filter(Boolean))].filter(mongoose.isValidObjectId);
    const actors = await User.find({ _id: { $in: actorIds } }).select('name userType').lean();
    const actorMap = new Map(actors.map((actor) => [String(actor._id), actor]));
    events.forEach((event) => { event.actor = actorMap.get(String(event.actorId || '')) || null; delete event.actorId; });
    events.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
    res.json({ events: events.slice(0, 500) });
  } catch (error) { console.error('Admin activity view failed:', error); res.status(500).json({ message: 'Unable to load activity history' }); }
});

router.get('/settings', async (_req, res) => {
  try { const settings = await ClinicSettings.findOne({ key: 'clinic' }).lean(); res.json({ settings: settings || null }); }
  catch (error) { res.status(500).json({ message: 'Unable to load clinic settings' }); }
});

router.put('/settings', async (req, res) => {
  try {
    const allowed = ['clinicName', 'address', 'phone', 'workingDays', 'openingTime', 'closingTime', 'defaultSessionDurationMins', 'minBookingNoticeMins', 'maxAdvanceDays'];
    const changes = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
    for (const key of ['clinicName', 'address', 'phone', 'openingTime', 'closingTime']) if (changes[key] !== undefined && typeof changes[key] !== 'string') return res.status(400).json({ message: `Invalid ${key}` });
    if (changes.workingDays !== undefined && (!Array.isArray(changes.workingDays) || changes.workingDays.length > 7 || new Set(changes.workingDays).size !== changes.workingDays.length || changes.workingDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6))) return res.status(400).json({ message: 'Working days must be unique weekdays numbered 0 through 6' });
    if (changes.openingTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(changes.openingTime)) return res.status(400).json({ message: 'Opening time must use HH:MM' });
    if (changes.closingTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(changes.closingTime)) return res.status(400).json({ message: 'Closing time must use HH:MM' });
    const openingTime = changes.openingTime ?? (await ClinicSettings.findOne({ key: 'clinic' }).select('openingTime').lean())?.openingTime;
    const closingTime = changes.closingTime ?? (await ClinicSettings.findOne({ key: 'clinic' }).select('closingTime').lean())?.closingTime;
    if (Boolean(openingTime) !== Boolean(closingTime)) return res.status(400).json({ message: 'Set both clinic opening and closing times, or leave both blank' });
    if (openingTime && closingTime && openingTime >= closingTime) return res.status(400).json({ message: 'Closing time must be after opening time' });
    for (const key of ['defaultSessionDurationMins', 'minBookingNoticeMins', 'maxAdvanceDays']) {
      if (changes[key] !== undefined && changes[key] !== null && (!Number.isInteger(Number(changes[key])) || Number(changes[key]) < 0)) return res.status(400).json({ message: `Invalid ${key}` });
    }
    changes.updatedBy = req.user._id;
    const settings = await ClinicSettings.findOneAndUpdate({ key: 'clinic' }, { $set: changes, $setOnInsert: { key: 'clinic' } }, { new: true, upsert: true, runValidators: true });
    res.json({ settings });
  } catch (error) { console.error('Clinic settings update failed:', error); res.status(400).json({ message: 'Clinic settings could not be saved' }); }
});

module.exports = router;
