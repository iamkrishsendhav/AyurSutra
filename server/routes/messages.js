const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const Message = require('../models/Message');
const User = require('../models/User');
const { notifyUsers } = require('../utils/notifications');

const router = express.Router();
router.use(auth);

async function allowedContact(user, otherId) {
  if (user.userType === 'admin' || !mongoose.isValidObjectId(otherId) || String(user._id) === String(otherId)) return null;
  const currentUser = await User.findById(user._id).select('userType assignedPractitioner professionalStatus accountStatus').lean();
  if (!currentUser || currentUser.accountStatus === 'suspended' || (currentUser.userType === 'practitioner' && currentUser.professionalStatus === 'inactive')) return null;
  if (user.userType === 'patient') {
    if (!currentUser.assignedPractitioner || String(currentUser.assignedPractitioner) !== String(otherId)) return null;
    return User.findOne({ _id: otherId, userType: 'practitioner', professionalStatus: { $ne: 'inactive' } }).select('_id name email userType profileImageUrl');
  }
  if (user.userType === 'practitioner') {
    return User.findOne({ _id: otherId, userType: 'patient', accountStatus: { $ne: 'suspended' }, assignedPractitioner: user._id }).select('_id name email userType profileImageUrl');
  }
  return null;
}

router.get('/contacts', async (req, res) => {
  try {
    let contacts = [];
    if (req.user.userType === 'patient') {
      const current = await User.findById(req.user._id).select('assignedPractitioner').lean();
      const contact = current?.assignedPractitioner && await allowedContact(req.user, current.assignedPractitioner);
      if (contact) contacts = [contact];
    } else if (req.user.userType === 'practitioner') {
      contacts = await User.find({ userType: 'patient', accountStatus: { $ne: 'suspended' }, assignedPractitioner: req.user._id }).select('_id name email userType profileImageUrl').sort({ name: 1 }).limit(500);
    }
    res.json({ contacts });
  } catch (error) { res.status(500).json({ message: 'Unable to load communication contacts' }); }
});

router.get('/inbox', async (req, res) => {
  try {
    const filter = { to: req.user._id };
    if (['1', 'true'].includes(String(req.query.unreadOnly))) filter.read = false;
    const messages = await Message.find(filter).sort({ createdAt: -1 }).limit(100).populate('from', 'name email userType profileImageUrl').lean();
    res.json({ messages, unreadCount: await Message.countDocuments({ to: req.user._id, read: false }) });
  } catch (error) { res.status(500).json({ message: 'Unable to load inbox' }); }
});

router.get('/conversation', async (req, res) => {
  try {
    const otherId = req.query.otherUserId || req.query.userBId;
    if (req.query.userAId && String(req.query.userAId) !== String(req.user._id)) return res.status(403).json({ message: 'Conversation access denied' });
    const contact = await allowedContact(req.user, otherId);
    if (!contact) return res.status(404).json({ message: 'Conversation not found' });
    const filter = { $or: [{ from: req.user._id, to: contact._id }, { from: contact._id, to: req.user._id }] };
    await Message.updateMany({ from: contact._id, to: req.user._id, read: false }, { $set: { read: true } });
    const messages = await Message.find(filter).sort({ createdAt: 1 }).limit(500).populate('from to', 'name email userType profileImageUrl').lean();
    res.json(messages);
  } catch (error) { res.status(500).json({ message: 'Unable to load conversation' }); }
});

router.post('/', async (req, res) => {
  try {
    const otherId = req.body.toId;
    const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
    if (!text || text.length > 5000) return res.status(400).json({ message: 'Message must contain 1 to 5000 characters' });
    const contact = await allowedContact(req.user, otherId);
    if (!contact) return res.status(403).json({ message: 'You cannot message this account' });
    const message = await Message.create({ from: req.user._id, to: contact._id, text });
    await notifyUsers([contact._id], 'message-received', `Message from ${req.user.name || 'your care team'}`, 'You have a new secure message.', { dedupeKey: `message:${message._id}` });
    const result = await Message.findById(message._id).populate('from to', 'name email userType profileImageUrl');
    res.status(201).json(result);
  } catch (error) { res.status(500).json({ message: 'Unable to send message' }); }
});

router.patch('/:id/read', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Message not found' });
    const message = await Message.findOneAndUpdate({ _id: req.params.id, to: req.user._id }, { $set: { read: true } }, { new: true });
    if (!message) return res.status(404).json({ message: 'Message not found' });
    res.json({ message });
  } catch (error) { res.status(500).json({ message: 'Unable to update message' }); }
});

module.exports = router;
