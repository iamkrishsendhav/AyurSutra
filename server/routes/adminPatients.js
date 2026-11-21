const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const User = require('../models/User');
const DoctorAssessment = require('../models/DoctorAssessment');
const TreatmentPlan = require('../models/TreatmentPlan');
const TherapySession = require('../models/TherapySession');
const { notifyUsers } = require('../utils/notifications');

const router = express.Router();
router.use(auth, (req, res, next) => {
  if (req.user.userType !== 'admin') return res.status(403).json({ message: 'Admin access required' });
  next();
});

router.get('/', async (req, res) => {
  try {
    const { q = '', accountStatus = 'all' } = req.query;
    if (typeof q !== 'string' || q.length > 120) return res.status(400).json({ message: 'Search query is too long' });
    if (!['all', 'active', 'suspended'].includes(accountStatus)) return res.status(400).json({ message: 'Invalid account status filter' });
    const filter = { userType: 'patient' };
    if (accountStatus === 'active') filter.accountStatus = { $in: ['active', null] };
    else if (accountStatus === 'suspended') filter.accountStatus = 'suspended';
    if (q.trim()) {
      const escaped = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [{ name: new RegExp(escaped, 'i') }, { email: new RegExp(escaped, 'i') }, { phone: new RegExp(escaped, 'i') }];
    }
    const patients = await User.find(filter)
      .select('name email phone status accountStatus createdAt assignedPractitioner progress currentStage personalDetails.dateOfBirth')
      .populate('assignedPractitioner', 'name email')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    res.json({ patients });
  } catch (error) {
    res.status(500).json({ message: 'Unable to load patient records' });
  }
});

router.get('/:patientId', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.patientId)) return res.status(400).json({ message: 'Invalid patient id' });
    const patient = await User.findOne({ _id: req.params.patientId, userType: 'patient' })
      .select('name email phone status accountStatus accountStatusHistory createdAt assignedPractitioner personalDetails address emergencyContact')
      .populate('assignedPractitioner', 'name email')
      .lean();
    if (!patient) return res.status(404).json({ message: 'Patient not found' });
    const [assessmentCount, plans, sessions] = await Promise.all([
      DoctorAssessment.countDocuments({ patient: patient._id }),
      TreatmentPlan.find({ patient: patient._id }).select('title status startDate therapies.therapyType generatedAt createdAt approval').sort({ createdAt: -1 }).lean(),
      TherapySession.find({ patient: patient._id }).select('therapyType phase sessionName date startTime durationMins status treatmentPlan').sort({ date: -1, startTime: -1 }).limit(100).lean(),
    ]);
    const generatedSessions = sessions.filter((item) => item.treatmentPlan);
    const completedSessions = generatedSessions.filter((item) => item.status === 'completed').length;
    const cancelledSessions = generatedSessions.filter((item) => item.status === 'cancelled').length;
    res.json({ patient, summary: { assessmentCount, plans, sessions, generatedSessionCount: generatedSessions.length, completedSessionCount: completedSessions, cancelledSessionCount: cancelledSessions, progress: generatedSessions.length ? Math.round(completedSessions / generatedSessions.length * 100) : null } });
  } catch (error) {
    res.status(500).json({ message: 'Unable to load patient summary' });
  }
});

router.patch('/:patientId/account-status', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.patientId)) return res.status(400).json({ message: 'Invalid patient id' });
    const { accountStatus } = req.body;
    if (!['active', 'suspended'].includes(accountStatus)) return res.status(400).json({ message: 'Account status must be active or suspended' });
    const patient = await User.findOneAndUpdate(
      { _id: req.params.patientId, userType: 'patient' },
      { $set: { accountStatus }, $push: { accountStatusHistory: { status: accountStatus, changedAt: new Date(), changedBy: req.user._id } } },
      { new: true, runValidators: true }
    ).select('name accountStatus accountStatusHistory');
    if (!patient) return res.status(404).json({ message: 'Patient not found' });
    const changedAt = patient.accountStatusHistory?.at(-1)?.changedAt || new Date();
    await notifyUsers([patient._id], 'account-update', 'Account status updated', `Your account status is now ${accountStatus}.`, { dedupeKey: `account-status:${patient._id}:${changedAt.getTime()}` });
    res.json({ success: true, patient });
  } catch (error) {
    res.status(500).json({ message: 'Unable to update patient account status' });
  }
});

module.exports = router;
