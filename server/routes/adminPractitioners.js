const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const User = require('../models/User');
const TherapySession = require('../models/TherapySession');
const { notifyUsers } = require('../utils/notifications');

const router = express.Router();
router.use(auth, (req, res, next) => req.user.userType === 'admin' ? next() : res.status(403).json({ message: 'Admin access required' }));

const validList = (value, max = 50) => Array.isArray(value) && value.length <= max && value.every((item) => typeof item === 'string' && item.trim().length <= 160);
const validSchedule = (value) => Array.isArray(value) && value.length <= 7 && value.every((item) => item && ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].includes(item.dayOfWeek) && /^([01]\d|2[0-3]):[0-5]\d$/.test(item.startTime) && /^([01]\d|2[0-3]):[0-5]\d$/.test(item.endTime) && item.startTime < item.endTime && typeof item.isAvailable === 'boolean');

router.get('/', async (req, res) => {
  try {
    const { q = '', status = 'all' } = req.query;
    if (typeof q !== 'string' || q.length > 120) return res.status(400).json({ message: 'Search query is too long' });
    if (!['all', 'active', 'inactive'].includes(status)) return res.status(400).json({ message: 'Invalid status filter' });
    const filter = { userType: 'practitioner' };
    if (status === 'active') filter.professionalStatus = { $in: ['active', null] };
    if (status === 'inactive') filter.professionalStatus = 'inactive';
    if (q.trim()) {
      const escaped = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [{ name: new RegExp(escaped, 'i') }, { email: new RegExp(escaped, 'i') }, { phone: new RegExp(escaped, 'i') }, { practiceAreas: new RegExp(escaped, 'i') }, { qualifications: new RegExp(escaped, 'i') }];
    }
    const practitioners = await User.find(filter).select('name email phone profileImageUrl licenseNumber qualifications practiceAreas experience verificationStatus professionalStatus availableForNewPatients practiceLocation createdAt').sort({ name: 1 }).limit(300).lean();
    const data = await Promise.all(practitioners.map(async (practitioner) => {
      const [assignedPatientCount, upcomingSessionCount, completedSessionCount] = await Promise.all([
        User.countDocuments({ userType: 'patient', assignedPractitioner: practitioner._id }),
        TherapySession.countDocuments({ practitioner: practitioner._id, status: { $in: ['scheduled', 'confirmed'] }, date: { $gte: new Date() } }),
        TherapySession.countDocuments({ practitioner: practitioner._id, status: 'completed' }),
      ]);
      return { ...practitioner, professionalStatus: practitioner.professionalStatus || 'active', assignedPatientCount, upcomingSessionCount, completedSessionCount };
    }));
    res.json({ practitioners: data });
  } catch (error) { res.status(500).json({ message: 'Unable to load practitioners' }); }
});

router.get('/:practitionerId', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.practitionerId)) return res.status(400).json({ message: 'Invalid practitioner id' });
    const practitioner = await User.findOne({ _id: req.params.practitionerId, userType: 'practitioner' }).select('-password -googleId').lean();
    if (!practitioner) return res.status(404).json({ message: 'Practitioner not found' });
    const [patients, sessions] = await Promise.all([
      User.find({ userType: 'patient', assignedPractitioner: practitioner._id }).select('name email phone status progress currentStage').sort({ name: 1 }).lean(),
      TherapySession.find({ practitioner: practitioner._id }).populate('patient', 'name email').sort({ date: -1, startTime: -1 }).limit(200).lean(),
    ]);
    res.json({ practitioner: { ...practitioner, professionalStatus: practitioner.professionalStatus || 'active' }, patients, sessions });
  } catch (error) { res.status(500).json({ message: 'Unable to load practitioner details' }); }
});

router.patch('/:practitionerId', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.practitionerId)) return res.status(400).json({ message: 'Invalid practitioner id' });
  const allowed = ['name', 'phone', 'profileImageUrl', 'licenseNumber', 'qualifications', 'practiceAreas', 'experience', 'bio', 'practiceLocation', 'consultationFee', 'availableForNewPatients', 'availabilitySchedule', 'professionalStatus'];
  const changes = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
  if (changes.name !== undefined && (typeof changes.name !== 'string' || !changes.name.trim() || changes.name.trim().length > 120)) return res.status(400).json({ message: 'Name must be 1 to 120 characters' });
  for (const field of ['qualifications', 'practiceAreas']) if (changes[field] !== undefined && !validList(changes[field])) return res.status(400).json({ message: `Invalid ${field}` });
  if (changes.experience !== undefined && (!Number.isFinite(Number(changes.experience)) || Number(changes.experience) < 0 || Number(changes.experience) > 80)) return res.status(400).json({ message: 'Experience must be between 0 and 80 years' });
  if (changes.professionalStatus !== undefined && !['active', 'inactive'].includes(changes.professionalStatus)) return res.status(400).json({ message: 'Status must be active or inactive' });
  if (changes.availabilitySchedule !== undefined && !validSchedule(changes.availabilitySchedule)) return res.status(400).json({ message: 'Invalid weekly availability schedule' });
  if (changes.profileImageUrl !== undefined && (typeof changes.profileImageUrl !== 'string' || changes.profileImageUrl.length > 2048 || (changes.profileImageUrl && !/^https:\/\//i.test(changes.profileImageUrl)))) return res.status(400).json({ message: 'Profile image must be an HTTPS URL' });
  if (changes.phone !== undefined && (typeof changes.phone !== 'string' || changes.phone.length > 40)) return res.status(400).json({ message: 'Invalid phone number' });
  if (changes.bio !== undefined && (typeof changes.bio !== 'string' || changes.bio.length > 5000)) return res.status(400).json({ message: 'Bio must be 5000 characters or less' });
  try {
    const practitioner = await User.findOneAndUpdate({ _id: req.params.practitionerId, userType: 'practitioner' }, { $set: changes }, { new: true, runValidators: true }).select('-password -googleId');
    if (!practitioner) return res.status(404).json({ message: 'Practitioner not found' });
    if (changes.professionalStatus !== undefined) await notifyUsers([practitioner._id], 'account-update', 'Professional account status updated', `Your professional status is now ${practitioner.professionalStatus}.`, { dedupeKey: `practitioner-status:${practitioner._id}:${Date.now()}` });
    res.json({ practitioner });
  } catch (error) { res.status(400).json({ message: 'Practitioner profile could not be updated' }); }
});

module.exports = router;
