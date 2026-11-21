const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const DoctorAssessment = require('../models/DoctorAssessment');
const TreatmentPlan = require('../models/TreatmentPlan');
const TherapySession = require('../models/TherapySession');
const User = require('../models/User');
const TherapyCatalogueItem = require('../models/TherapyCatalogueItem');
const { overlaps } = require('../utils/sessionTime');
const { acquireScheduleLocks } = require('../utils/scheduleLocks');
const { validateClinicSlot } = require('../utils/clinicScheduling');
const { notifyUsers, notifyAdmins } = require('../utils/notifications');

const router = express.Router();
router.use(auth);
const isClinician = (req) => ['practitioner', 'admin'].includes(req.user.userType);
async function canAccessPatient(user, patient) {
  return user.userType === 'admin' || (user.userType === 'practitioner' && String(patient.assignedPractitioner || '') === String(user._id));
}

// Assessment history: clinicians may create assessments for assigned patients;
// patients can read only their own assessment history.
router.get('/patients/:patientId/assessments', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.patientId)) return res.status(400).json({ message: 'Invalid patient id' });
    const patient = await User.findOne({ _id: req.params.patientId, userType: 'patient' }).select('_id assignedPractitioner');
    if (!patient) return res.status(404).json({ message: 'Patient not found' });
    const own = req.user.userType === 'patient' && String(req.user._id) === String(patient._id);
    if (!own && !(await canAccessPatient(req.user, patient))) return res.status(403).json({ message: 'Access denied' });
    const query = { patient: patient._id };
    if (req.user.userType === 'practitioner') query.doctor = req.user._id;
    const assessments = await DoctorAssessment.find(query).sort({ assessedAt: -1 }).lean();
    res.json({ assessments: own ? assessments.map(({ _id, assessedAt, symptoms, observations, diagnosis, recommendations }) => ({ _id, assessedAt, symptoms, observations, diagnosis, recommendations })) : assessments });
  } catch (error) { res.status(500).json({ message: 'Unable to load assessments' }); }
});

router.post('/patients/:patientId/assessments', async (req, res) => {
  try {
    if (!isClinician(req)) return res.status(403).json({ message: 'Practitioner access required' });
    const patient = await User.findOne({ _id: req.params.patientId, userType: 'patient' });
    if (!patient) return res.status(404).json({ message: 'Patient not found' });
    if (!(await canAccessPatient(req.user, patient))) return res.status(403).json({ message: 'Patient is not assigned to this practitioner' });
    const { symptoms = [], observations, diagnosis, recommendations, clinicalNotes } = req.body;
    if (!Array.isArray(symptoms) || symptoms.some((item) => typeof item !== 'string') || ![observations, diagnosis, recommendations, clinicalNotes].every((v) => v === undefined || typeof v === 'string')) return res.status(400).json({ message: 'Invalid assessment fields' });
    const assessment = await DoctorAssessment.create({ patient: patient._id, doctor: req.user._id, symptoms, observations, diagnosis, recommendations, clinicalNotes });
    res.status(201).json({ assessment });
  } catch (error) { res.status(400).json({ message: 'Assessment could not be saved' }); }
});

router.get('/patients/:patientId', async (req, res) => {
  try {
    const patient = await User.findOne({ _id: req.params.patientId, userType: 'patient' }).select('_id assignedPractitioner');
    if (!patient) return res.status(404).json({ message: 'Patient not found' });
    const own = req.user.userType === 'patient' && String(req.user._id) === String(patient._id);
    if (!own && !(await canAccessPatient(req.user, patient))) return res.status(403).json({ message: 'Access denied' });
    const filter = { patient: patient._id };
    if (req.user.userType === 'practitioner') Object.assign(filter, { doctor: req.user._id });
    if (req.user.userType === 'therapist') filter.status = 'approved';
    const plans = await TreatmentPlan.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ plans });
  } catch (error) { res.status(500).json({ message: 'Unable to load treatment plans' }); }
});

router.post('/patients/:patientId', async (req, res) => {
  try {
    if (!isClinician(req)) return res.status(403).json({ message: 'Practitioner access required' });
    const patient = await User.findOne({ _id: req.params.patientId, userType: 'patient' });
    if (!patient) return res.status(404).json({ message: 'Patient not found' });
    if (!(await canAccessPatient(req.user, patient))) return res.status(403).json({ message: 'Patient is not assigned to this practitioner' });
    const { assessmentId, therapies, startDate, submitForApproval = true, title = '', objectives = '', precautions = '' } = req.body;
    if (typeof title !== 'string' || title.length > 160 || typeof objectives !== 'string' || objectives.length > 3000 || typeof precautions !== 'string' || precautions.length > 3000 || typeof submitForApproval !== 'boolean') return res.status(400).json({ message: 'Invalid treatment plan fields' });
    if (!startDate || Number.isNaN(Date.parse(startDate)) || new Date(startDate) < new Date(new Date().setHours(0, 0, 0, 0))) return res.status(400).json({ message: 'A valid current or future start date is required' });
    const assessment = await DoctorAssessment.findOne({ _id: assessmentId, patient: patient._id, doctor: req.user._id });
    if (!assessment) return res.status(400).json({ message: 'A matching doctor assessment is required' });
    if (!Array.isArray(therapies) || therapies.length === 0) return res.status(400).json({ message: 'At least one therapy is required' });
    const normalizedTherapies = [];
    for (const entry of therapies) {
      if (!entry || typeof entry !== 'object') return res.status(400).json({ message: 'Invalid therapy entry' });
      if (entry.catalogTherapyId) {
        if (!mongoose.isValidObjectId(entry.catalogTherapyId)) return res.status(400).json({ message: 'Invalid catalogue therapy id' });
        const catalogue = await TherapyCatalogueItem.findOne({ _id: entry.catalogTherapyId, active: true }).lean();
        if (!catalogue) return res.status(400).json({ message: 'Selected therapy is inactive or unavailable' });
        normalizedTherapies.push({
          ...entry,
          therapyType: catalogue.name,
          durationMins: catalogue.durationMins,
          catalogTherapy: catalogue._id,
          catalogSnapshot: {
            name: catalogue.name, category: catalogue.category, description: catalogue.description,
            durationMins: catalogue.durationMins, requiredSkills: catalogue.requiredSkills || [],
            preparationInstructions: catalogue.preparationInstructions || '', postTherapyInstructions: catalogue.postTherapyInstructions || '',
            contraindications: catalogue.contraindications || '',
          },
        });
      } else normalizedTherapies.push(entry);
    }
    const plan = await TreatmentPlan.create({ patient: patient._id, assessment: assessment._id, doctor: req.user._id, title: title.trim(), objectives: objectives.trim(), precautions: precautions.trim(), startDate: new Date(startDate), therapies: normalizedTherapies, status: submitForApproval ? 'pending-approval' : 'draft' });
    if (submitForApproval) {
      await notifyUsers([patient._id], 'plan-submitted', 'Treatment plan submitted', 'Your clinician submitted a treatment plan for review.', { dedupeKey: `plan-submitted:${plan._id}` });
      await notifyAdmins('plan-submitted', 'Treatment plan awaiting review', 'A treatment plan is awaiting clinician review.', { dedupeKey: `plan-submitted-admin:${plan._id}` });
    }
    res.status(201).json({ plan });
  } catch (error) { res.status(400).json({ message: 'Treatment plan is invalid' }); }
});

router.post('/:planId/review', async (req, res) => {
  try {
    if (!isClinician(req)) return res.status(403).json({ message: 'Doctor access required' });
    const { decision, note } = req.body;
    if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ message: 'Decision must be approved or rejected' });
    if (note !== undefined && (typeof note !== 'string' || note.length > 2000)) return res.status(400).json({ message: 'Review note must be 2000 characters or less' });
    const pendingPlan = await TreatmentPlan.findOne({ _id: req.params.planId, status: 'pending-approval' });
    if (!pendingPlan) return res.status(404).json({ message: 'Pending plan not found or not authorized' });
    if (req.user.userType === 'practitioner') {
      const patient = await User.findOne({ _id: pendingPlan.patient, userType: 'patient' }).select('_id assignedPractitioner');
      if (String(pendingPlan.doctor) !== String(req.user._id) || String(patient?.assignedPractitioner || '') !== String(req.user._id)) {
        return res.status(404).json({ message: 'Pending plan not found or not authorized' });
      }
    }
    const reviewedAt = new Date();
    const plan = await TreatmentPlan.findOneAndUpdate(
      { _id: pendingPlan._id, status: 'pending-approval' },
      { $set: { status: decision, approval: { status: decision, reviewedBy: req.user._id, reviewedAt, ...(note !== undefined ? { note: note.trim() } : {}) } }, $push: { reviewHistory: { status: decision, reviewedBy: req.user._id, reviewedAt, ...(note !== undefined ? { note: note.trim() } : {}) } } },
      { new: true, runValidators: true }
    );
    if (!plan) return res.status(409).json({ message: 'Plan was already reviewed' });
    await notifyUsers([pendingPlan.patient, pendingPlan.doctor], decision === 'approved' ? 'plan-approved' : 'plan-rejected', decision === 'approved' ? 'Treatment plan approved' : 'Treatment plan declined', decision === 'approved' ? 'Your treatment plan has been approved.' : 'Your treatment plan was declined. Contact your practitioner for details.', { dedupeKey: `plan-${decision}:${plan._id}` });
    res.json({ plan });
  } catch (error) { res.status(500).json({ message: 'Unable to review treatment plan' }); }
});

router.post('/:planId/generate-sessions', async (req, res) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const plan = await TreatmentPlan.findOne({ _id: req.params.planId, status: 'approved' }).session(session);
      if (!plan) { const error = new Error('Only approved treatment plans can generate sessions'); error.status = 409; throw error; }
      const patient = await User.findById(plan.patient).session(session);
      if (!patient || !(await canAccessPatient(req.user, patient)) || (req.user.userType === 'practitioner' && String(plan.doctor) !== String(req.user._id))) { const error = new Error('Access denied'); error.status = 403; throw error; }
      if (!patient.assignedPractitioner) { const error = new Error('Assign a practitioner before generating sessions'); error.status = 409; throw error; }
      const therapist = await User.findById(patient.assignedPractitioner).select('practiceAreas qualifications professionalStatus').session(session);
      if (!therapist) { const error = new Error('Assigned practitioner is unavailable'); error.status = 409; throw error; }
      if (therapist.professionalStatus === 'inactive') { const error = new Error('Assigned practitioner is inactive'); error.status = 409; throw error; }
      if (plan.generatedAt) { const error = new Error('Sessions have already been generated for this plan'); error.status = 409; throw error; }
      const docs = [];
      for (let therapyIndex = 0; therapyIndex < plan.therapies.length; therapyIndex++) {
        const therapy = plan.therapies[therapyIndex];
        const practitionerSkills = [...(therapist.practiceAreas || []), ...(therapist.qualifications || [])];
        const requiredSkills = therapy.catalogSnapshot?.requiredSkills || [];
        if (requiredSkills.length && requiredSkills.some((skill) => !practitionerSkills.includes(skill))) { const error = new Error(`Assigned practitioner does not meet the required skills for ${therapy.therapyType}`); error.status = 409; throw error; }
        if (!requiredSkills.length && !therapy.catalogTherapy && therapist.practiceAreas?.length && !therapist.practiceAreas.includes(therapy.therapyType)) { const error = new Error(`Assigned practitioner is not qualified for ${therapy.therapyType}`); error.status = 409; throw error; }
        for (let occurrence = 0; occurrence < therapy.occurrences; occurrence++) {
          const existingOccurrence = await TherapySession.exists({
            treatmentPlan: plan._id,
            planSessionKey: { $in: [`${therapyIndex}:${occurrence}`, `reception:${therapy._id}:${occurrence}`] },
          }).session(session);
          if (existingOccurrence) continue;
          const date = new Date(plan.startDate); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() + occurrence * therapy.frequencyDays);
          const dayEnd = new Date(date); dayEnd.setDate(dayEnd.getDate() + 1);
          const clinicError = await validateClinicSlot({ date, startTime: therapy.startTime, durationMins: therapy.catalogSnapshot?.durationMins || therapy.durationMins }, session);
          if (clinicError) { const error = new Error(clinicError); error.status = 409; throw error; }
          await acquireScheduleLocks(session, { date, patientId: plan.patient, practitionerId: patient.assignedPractitioner });
          const query = { date: { $gte: date, $lt: dayEnd }, status: { $ne: 'cancelled' }, patient: { $ne: null }, $or: [{ patient: plan.patient }, { practitioner: patient.assignedPractitioner }] };
          const existing = await TherapySession.find(query).select('startTime durationMins').session(session);
          if (existing.some((item) => overlaps(therapy.startTime, therapy.durationMins, item.startTime, item.durationMins || 60))) { const error = new Error('Schedule conflict exists'); error.status = 409; throw error; }
          const sameDayGenerated = docs.filter((item) => item.date >= date && item.date < dayEnd);
          if (sameDayGenerated.some((item) => overlaps(therapy.startTime, therapy.durationMins, item.startTime, item.durationMins || 60))) { const error = new Error('Therapies in this plan contain overlapping sessions'); error.status = 409; throw error; }
          docs.push({ patient: plan.patient, practitioner: patient.assignedPractitioner, treatmentPlan: plan._id, catalogTherapy: therapy.catalogTherapy || null, therapySnapshot: therapy.catalogSnapshot || undefined, planSessionKey: `${therapyIndex}:${occurrence}`, therapyType: therapy.therapyType, phase: therapy.phase, sessionName: therapy.sessionName, date, startTime: therapy.startTime, durationMins: therapy.catalogSnapshot?.durationMins || therapy.durationMins, notes: therapy.instructions, status: 'scheduled' });
        }
      }
      const generatedSessions = await TherapySession.insertMany(docs, { session });
      plan.generatedAt = new Date();
      await plan.save({ session });
      result = { count: docs.length, sessionIds: generatedSessions.map((item) => item._id), patientId: plan.patient, practitionerId: patient.assignedPractitioner };
    });
    if (result?.sessionIds?.length) await Promise.all(result.sessionIds.map((id) => notifyUsers([result.patientId, result.practitionerId], 'appointment-booked', 'Therapy session scheduled', 'A therapy session has been added to the approved treatment schedule.', { dedupeKey: `appointment-booked:${id}` })));
    res.status(201).json({ createdCount: result.count });
  } catch (error) { res.status(error.status || 500).json({ message: error.status ? error.message : 'Session generation failed' }); }
  finally { await session.endSession(); }
});

module.exports = router;
