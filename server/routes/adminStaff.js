const express = require('express');
const bcrypt = require('bcryptjs');
const auth = require('../middleware/auth');
const User = require('../models/User');
const { isValidUserPassword } = require('../utils/passwordPolicy');
const { notifyUsers } = require('../utils/notifications');

const router = express.Router();
router.use(auth, (req, res, next) => req.user.userType === 'admin' ? next() : res.status(403).json({ message: 'Admin access required' }));

router.get('/', async (_req, res) => {
  try {
    const staff = await User.find({ userType: { $in: ['practitioner', 'receptionist'] } })
      .select('name email phone userType accountStatus professionalStatus profileImageUrl qualifications practiceAreas experience employeeId joiningDate createdAt')
      .sort({ userType: 1, name: 1 }).limit(500).lean();
    res.json({ staff });
  } catch (_error) { res.status(500).json({ message: 'Unable to load staff accounts' }); }
});

router.post('/', async (req, res) => {
  try {
    const { name, email, phone = '', password, userType, employeeId = '', joiningDate, profileImageUrl = '' } = req.body;
    if (!['practitioner', 'receptionist'].includes(userType)) return res.status(400).json({ message: 'Only practitioner or receptionist accounts can be created here' });
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 120) return res.status(400).json({ message: 'Name must be between 2 and 120 characters' });
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.length > 254) return res.status(400).json({ message: 'Enter a valid email address' });
    if (!isValidUserPassword(password)) return res.status(400).json({ message: 'Set a temporary password between 6 and 128 characters' });
    if (typeof phone !== 'string' || phone.length > 40) return res.status(400).json({ message: 'Invalid phone number' });
    if (typeof profileImageUrl !== 'string' || profileImageUrl.length > 2048 || (profileImageUrl && !/^https:\/\//i.test(profileImageUrl))) return res.status(400).json({ message: 'Profile image must be an HTTPS URL' });
    if (userType === 'receptionist' && (typeof employeeId !== 'string' || employeeId.trim().length < 2 || employeeId.length > 40)) return res.status(400).json({ message: 'Receptionists require an employee ID' });
    const normalizedEmail = email.trim().toLowerCase();
    if (await User.exists({ email: normalizedEmail })) return res.status(409).json({ message: 'An account already exists for this email' });
    const user = new User({
      name: name.trim(), email: normalizedEmail, phone: phone.trim(), userType,
      password: await bcrypt.hash(password, 12), accountStatus: 'active', mustChangePassword: true,
      profileImageUrl: profileImageUrl.trim(),
      ...(userType === 'practitioner' ? { verificationStatus: 'pending', professionalStatus: 'active' } : { employeeId: employeeId.trim(), joiningDate: joiningDate ? new Date(joiningDate) : new Date() }),
    });
    if (joiningDate && Number.isNaN(new Date(joiningDate).getTime())) return res.status(400).json({ message: 'Invalid joining date' });
    await user.save();
    res.status(201).json({ staff: { _id: user._id, name: user.name, email: user.email, phone: user.phone, userType: user.userType, accountStatus: user.accountStatus, verificationStatus: user.verificationStatus, employeeId: user.employeeId, joiningDate: user.joiningDate, profileImageUrl: user.profileImageUrl } });
  } catch (_error) { res.status(500).json({ message: 'Staff account could not be created' }); }
});

router.patch('/:staffId/account-status', async (req, res) => {
  try {
    const { accountStatus } = req.body;
    if (!['active', 'suspended'].includes(accountStatus)) return res.status(400).json({ message: 'Account status must be active or suspended' });
    const staff = await User.findOneAndUpdate(
      { _id: req.params.staffId, userType: { $in: ['practitioner', 'receptionist'] } },
      { $set: { accountStatus }, $push: { accountStatusHistory: { status: accountStatus, changedAt: new Date(), changedBy: req.user._id } } },
      { new: true, runValidators: true }
    ).select('name email userType accountStatus professionalStatus employeeId');
    if (!staff) return res.status(404).json({ message: 'Staff account not found' });
    res.json({ staff });
  } catch (_error) { res.status(400).json({ message: 'Staff status could not be updated' }); }
});

router.patch('/:staffId/reset-password', async (req, res) => {
  try {
    if (!isValidUserPassword(req.body?.password)) return res.status(400).json({ message: 'Temporary password must contain 6 to 128 characters' });
    const staff = await User.findOne({ _id: req.params.staffId, userType: { $in: ['practitioner', 'receptionist'] } });
    if (!staff) return res.status(404).json({ message: 'Staff account not found' });
    staff.password = await bcrypt.hash(req.body.password, 12); staff.mustChangePassword = true; await staff.save();
    await notifyUsers([staff._id], 'account-update', 'Password reset required', 'An administrator reset your temporary password. Change it after signing in.', { dedupeKey: `staff-password-reset:${staff._id}:${staff.updatedAt.getTime()}` });
    res.json({ staff: { _id: staff._id, name: staff.name, email: staff.email, userType: staff.userType, mustChangePassword: true } });
  } catch (_error) { res.status(400).json({ message: 'Staff password could not be reset' }); }
});

router.patch('/:staffId', async (req, res) => {
  try {
    const staff = await User.findOne({ _id: req.params.staffId, userType: { $in: ['practitioner', 'receptionist'] } });
    if (!staff) return res.status(404).json({ message: 'Staff account not found' });
    const allowed = staff.userType === 'receptionist' ? ['name', 'phone', 'profileImageUrl', 'employeeId', 'joiningDate'] : ['name', 'phone', 'profileImageUrl'];
    for (const key of Object.keys(req.body)) if (!allowed.includes(key)) return res.status(400).json({ message: `Field ${key} cannot be edited here` });
    if (req.body.name !== undefined) { if (typeof req.body.name !== 'string' || req.body.name.trim().length < 2 || req.body.name.length > 120) return res.status(400).json({ message: 'Invalid name' }); staff.name = req.body.name.trim(); }
    if (req.body.phone !== undefined) { if (typeof req.body.phone !== 'string' || req.body.phone.length > 40) return res.status(400).json({ message: 'Invalid phone number' }); staff.phone = req.body.phone.trim(); }
    if (req.body.profileImageUrl !== undefined) { if (typeof req.body.profileImageUrl !== 'string' || req.body.profileImageUrl.length > 2048 || (req.body.profileImageUrl && !/^https:\/\//i.test(req.body.profileImageUrl))) return res.status(400).json({ message: 'Profile image must be an HTTPS URL' }); staff.profileImageUrl = req.body.profileImageUrl.trim(); }
    if (staff.userType === 'receptionist') {
      if (req.body.employeeId !== undefined) { if (typeof req.body.employeeId !== 'string' || req.body.employeeId.trim().length < 2 || req.body.employeeId.length > 40) return res.status(400).json({ message: 'Invalid employee ID' }); staff.employeeId = req.body.employeeId.trim(); }
      if (req.body.joiningDate !== undefined) { if (Number.isNaN(new Date(req.body.joiningDate).getTime())) return res.status(400).json({ message: 'Invalid joining date' }); staff.joiningDate = new Date(req.body.joiningDate); }
    }
    await staff.save();
    res.json({ staff: { _id: staff._id, name: staff.name, email: staff.email, phone: staff.phone, userType: staff.userType, accountStatus: staff.accountStatus, professionalStatus: staff.professionalStatus, profileImageUrl: staff.profileImageUrl, employeeId: staff.employeeId, joiningDate: staff.joiningDate } });
  } catch (_error) { res.status(400).json({ message: 'Staff profile could not be updated' }); }
});

module.exports = router;
