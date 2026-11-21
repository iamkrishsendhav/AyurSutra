const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const TherapyCatalogueItem = require('../models/TherapyCatalogueItem');

const router = express.Router();
router.use(auth);
const isAdmin = (req) => req.user.userType === 'admin';

function validateFields(data, partial = false) {
  const errors = [];
  for (const field of ['name', 'category', 'description']) {
    if (!partial || data[field] !== undefined) {
      if (typeof data[field] !== 'string' || !data[field].trim()) errors.push(`${field} is required`);
    }
  }
  if (!partial || data.durationMins !== undefined) {
    if (!Number.isInteger(Number(data.durationMins)) || Number(data.durationMins) < 1 || Number(data.durationMins) > 480) errors.push('durationMins must be between 1 and 480');
  }
  if (data.requiredSkills !== undefined && (!Array.isArray(data.requiredSkills) || data.requiredSkills.length > 50 || data.requiredSkills.some((skill) => typeof skill !== 'string' || skill.trim().length > 120))) errors.push('requiredSkills must be a list of short text values');
  for (const field of ['preparationInstructions', 'postTherapyInstructions', 'contraindications']) {
    if (data[field] !== undefined && (typeof data[field] !== 'string' || data[field].length > 5000)) errors.push(`${field} must be 5000 characters or less`);
  }
  if (data.active !== undefined && typeof data.active !== 'boolean') errors.push('active must be a boolean');
  return errors;
}

router.get('/', async (req, res) => {
  try {
    const { q = '', category = 'all', active = 'active' } = req.query;
    if (typeof q !== 'string' || q.length > 120) return res.status(400).json({ message: 'Search query is too long' });
    if (!['all', 'active', 'inactive'].includes(active) || (active !== 'active' && !isAdmin(req))) return res.status(403).json({ message: 'Only admins may view inactive catalogue entries' });
    const filter = {};
    if (active !== 'all') filter.active = active === 'active';
    if (category !== 'all') filter.category = category;
    if (q.trim()) {
      const escaped = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [{ name: new RegExp(escaped, 'i') }, { description: new RegExp(escaped, 'i') }, { category: new RegExp(escaped, 'i') }, { requiredSkills: new RegExp(escaped, 'i') }];
    }
    const therapies = await TherapyCatalogueItem.find(filter).sort({ category: 1, name: 1 }).limit(300).lean();
    const categories = await TherapyCatalogueItem.distinct('category', { ...(isAdmin(req) ? {} : { active: true }) });
    res.json({ therapies, categories });
  } catch (error) { res.status(500).json({ message: 'Unable to load therapy catalogue' }); }
});

router.get('/:therapyId', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.therapyId)) return res.status(400).json({ message: 'Invalid therapy id' });
    const filter = { _id: req.params.therapyId };
    if (!isAdmin(req)) filter.active = true;
    const therapy = await TherapyCatalogueItem.findOne(filter).lean();
    if (!therapy) return res.status(404).json({ message: 'Therapy not found' });
    res.json({ therapy });
  } catch (error) { res.status(500).json({ message: 'Unable to load therapy details' }); }
});

router.post('/', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ message: 'Admin access required' });
  const errors = validateFields(req.body);
  if (errors.length) return res.status(400).json({ message: errors.join('; ') });
  try {
    const therapy = await TherapyCatalogueItem.create({ ...req.body, requiredSkills: (req.body.requiredSkills || []).map((skill) => skill.trim()).filter(Boolean), createdBy: req.user._id, updatedBy: req.user._id });
    res.status(201).json({ therapy });
  } catch (error) {
    res.status(error.code === 11000 ? 409 : 400).json({ message: error.code === 11000 ? 'A therapy with this name already exists' : 'Therapy could not be saved' });
  }
});

router.patch('/:therapyId', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ message: 'Admin access required' });
  const allowed = ['name', 'category', 'description', 'durationMins', 'requiredSkills', 'preparationInstructions', 'postTherapyInstructions', 'contraindications', 'active'];
  const changes = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
  const errors = validateFields(changes, true);
  if (errors.length) return res.status(400).json({ message: errors.join('; ') });
  if (changes.requiredSkills) changes.requiredSkills = changes.requiredSkills.map((skill) => skill.trim()).filter(Boolean);
  changes.updatedBy = req.user._id;
  try {
    const therapy = await TherapyCatalogueItem.findByIdAndUpdate(req.params.therapyId, { $set: changes }, { new: true, runValidators: true });
    if (!therapy) return res.status(404).json({ message: 'Therapy not found' });
    res.json({ therapy });
  } catch (error) { res.status(error.code === 11000 ? 409 : 400).json({ message: error.code === 11000 ? 'A therapy with this name already exists' : 'Therapy could not be updated' }); }
});

module.exports = router;
