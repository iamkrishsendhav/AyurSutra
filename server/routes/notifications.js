const express = require('express');
const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const User = require('../models/User');
const auth = require('../middleware/auth');

const router = express.Router();
router.use(auth);
const types = Notification.schema.path('type').enumValues;
const emailAvailable = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

router.get('/', async (req, res) => {
  try {
    const filter = { user: req.user._id };
    if (req.query.type && req.query.type !== 'all') {
      if (!types.includes(req.query.type)) return res.status(400).json({ success: false, message: 'Invalid notification type' });
      filter.type = req.query.type;
    }
    const [notifications, unreadCount, totalCount] = await Promise.all([
      Notification.find(filter).sort({ scheduledAt: -1, _id: -1 }).limit(100).lean(),
      Notification.countDocuments({ ...filter, read: false }),
      Notification.countDocuments(filter),
    ]);
    res.json({ success: true, notifications, unreadCount, totalCount });
  } catch (err) {
    console.error('Notification list failed:', err.name);
    res.status(500).json({ success: false, message: 'Unable to load notifications' });
  }
});

router.get('/preferences', async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('notificationPreferences').lean();
    res.json({ preferences: user?.notificationPreferences || { inApp: true, categories: {}, sessionReminders: true, followUpReminders: true, email: false }, emailAvailable });
  } catch (err) { res.status(500).json({ message: 'Unable to load notification preferences' }); }
});

router.put('/preferences', async (req, res) => {
  try {
    const input = req.body || {};
    const updates = {};
    for (const key of ['inApp', 'sessionReminders', 'followUpReminders']) {
      if (input[key] !== undefined) {
        if (typeof input[key] !== 'boolean') return res.status(400).json({ message: `Invalid ${key} preference` });
        updates[`notificationPreferences.${key}`] = input[key];
      }
    }
    if (input.email !== undefined) {
      if (typeof input.email !== 'boolean') return res.status(400).json({ message: 'Invalid email preference' });
      if (input.email && !emailAvailable) return res.status(400).json({ message: 'Email delivery is not configured' });
      updates['notificationPreferences.email'] = input.email;
    }
    if (input.categories !== undefined) {
      if (!input.categories || typeof input.categories !== 'object' || Array.isArray(input.categories)) return res.status(400).json({ message: 'Invalid notification categories' });
      for (const [type, enabled] of Object.entries(input.categories)) {
        if (!types.includes(type) || type === 'account-update' || typeof enabled !== 'boolean') return res.status(400).json({ message: 'Invalid or protected notification category' });
        updates[`notificationPreferences.categories.${type}`] = enabled;
      }
    }
    const user = await User.findByIdAndUpdate(req.user._id, { $set: updates }, { new: true, runValidators: true }).select('notificationPreferences').lean();
    res.json({ preferences: user.notificationPreferences, emailAvailable });
  } catch (err) { res.status(500).json({ message: 'Unable to save notification preferences' }); }
});

router.post('/read-all', async (req, res) => {
  try {
    const filter = { user: req.user._id, read: false };
    if (req.body?.type && req.body.type !== 'all') {
      if (!types.includes(req.body.type)) return res.status(400).json({ success: false, message: 'Invalid notification type' });
      filter.type = req.body.type;
    }
    const result = await Notification.updateMany(filter, { $set: { read: true } });
    res.json({ success: true, modifiedCount: result.modifiedCount });
  } catch (err) {
    console.error('Notification read-all failed:', err.name);
    res.status(500).json({ success: false, message: 'Unable to update notifications' });
  }
});

router.post('/:id/read', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, message: 'Notification not found' });
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { $set: { read: true } },
      { new: true, runValidators: true }
    );
    if (!notification) return res.status(404).json({ success: false, message: 'Notification not found' });
    res.json({ success: true, notification });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Unable to update notification' });
  }
});

module.exports = router;
