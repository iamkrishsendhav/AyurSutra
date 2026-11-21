const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const PatientFollowUp = require('../models/PatientFollowUp');
const User = require('../models/User');
const TherapySession = require('../models/TherapySession');
const TreatmentPlan = require('../models/TreatmentPlan');
const { notifyUsers } = require('../utils/notifications');

const router = express.Router();
router.use(auth);

router.get('/', async (req, res) => {
  try {
    const filter = req.user.userType === 'admin' ? {} : req.user.userType === 'practitioner' ? { practitioner: req.user._id } : { patient: req.user._id };
    const records = await PatientFollowUp.find(filter).populate('patient', 'name email').populate('practitioner', 'name email').populate('session', 'therapyType sessionName date startTime status').populate('treatmentPlan', 'status startDate').sort({ dueAt: 1 });
    res.json({ followUps: records });
  } catch (error) { console.error('Follow-up list failed:', error); res.status(500).json({ message: 'Unable to load follow-ups' }); }
});

router.post('/', async (req, res) => {
  try {
    if (!['practitioner', 'admin'].includes(req.user.userType)) return res.status(403).json({ message: 'Clinician access required' });
    const { patientId, dueAt, notes, sessionId, treatmentPlanId } = req.body;
    if (!mongoose.isValidObjectId(patientId) || !dueAt || Number.isNaN(new Date(dueAt).getTime())) return res.status(400).json({ message: 'Valid patient and due date are required' });
    if (typeof notes !== 'string' || !notes.trim() || notes.length > 3000) return res.status(400).json({ message: 'Follow-up notes are required (maximum 3000 characters)' });
    const patient = await User.findOne({ _id: patientId, userType: 'patient' }).select('_id assignedPractitioner');
    if (!patient) return res.status(404).json({ message: 'Patient not found' });
    if (req.user.userType === 'practitioner' && String(patient.assignedPractitioner) !== String(req.user._id)) return res.status(403).json({ message: 'Patient is not assigned to this practitioner' });
    const responsiblePractitionerId = req.user.userType === 'practitioner' ? req.user._id : (req.body.practitionerId || patient.assignedPractitioner);
    if (!mongoose.isValidObjectId(responsiblePractitionerId)) return res.status(400).json({ message: 'A responsible practitioner is required' });
    const responsiblePractitioner = await User.findOne({ _id: responsiblePractitionerId, userType: 'practitioner' }).select('_id');
    if (!responsiblePractitioner) return res.status(400).json({ message: 'Responsible practitioner is invalid' });
    if (sessionId) {
      if (!mongoose.isValidObjectId(sessionId)) return res.status(400).json({ message: 'Invalid session' });
      const session = await TherapySession.findOne({ _id: sessionId, patient: patient._id });
      if (!session || String(session.practitioner) !== String(responsiblePractitionerId)) return res.status(403).json({ message: 'Session is not accessible to the responsible practitioner' });
    }
    if (treatmentPlanId) {
      if (!mongoose.isValidObjectId(treatmentPlanId)) return res.status(400).json({ message: 'Invalid treatment plan' });
      const plan = await TreatmentPlan.findOne({ _id: treatmentPlanId, patient: patient._id });
      if (!plan || String(plan.doctor) !== String(responsiblePractitionerId)) return res.status(403).json({ message: 'Treatment plan is not accessible to the responsible practitioner' });
    }
    const followUp = await PatientFollowUp.create({ patient: patient._id, practitioner: responsiblePractitionerId, dueAt: new Date(dueAt), notes: notes.trim(), session: sessionId || null, treatmentPlan: treatmentPlanId || null, createdBy: req.user._id });
    await notifyUsers([patient._id, responsiblePractitionerId], 'follow-up-scheduled', 'Follow-up scheduled', `A follow-up is scheduled for ${new Date(dueAt).toLocaleDateString()}.`, { dedupeKey: `follow-up-scheduled:${followUp._id}` });
    res.status(201).json({ followUp });
  } catch (error) { console.error('Follow-up creation failed:', error); res.status(500).json({ message: 'Unable to create follow-up' }); }
});

router.patch('/:id/complete', async (req, res) => {
  try {
    if (!['practitioner', 'admin'].includes(req.user.userType)) return res.status(403).json({ message: 'Clinician access required' });
    const followUp = await PatientFollowUp.findById(req.params.id);
    if (!followUp) return res.status(404).json({ message: 'Follow-up not found' });
    if (req.user.userType === 'practitioner' && String(followUp.practitioner) !== String(req.user._id)) return res.status(403).json({ message: 'Not authorized to complete this follow-up' });
    if (followUp.status === 'completed') return res.status(409).json({ message: 'Follow-up is already completed' });
    followUp.status = 'completed'; followUp.completedAt = new Date(); followUp.completedBy = req.user._id; await followUp.save();
    await notifyUsers([followUp.patient, followUp.practitioner], 'follow-up-completed', 'Follow-up completed', 'A follow-up has been marked complete.', { dedupeKey: `follow-up-completed:${followUp._id}` });
    res.json({ followUp });
  } catch (error) { console.error('Follow-up update failed:', error); res.status(500).json({ message: 'Unable to update follow-up' }); }
});

module.exports = router;
