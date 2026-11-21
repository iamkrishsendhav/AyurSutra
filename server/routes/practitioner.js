const express = require('express');
const router = express.Router();
const User = require('../models/User');
const TherapySession = require('../models/TherapySession');
const TreatmentPlan = require('../models/TreatmentPlan');
const auth = require('../middleware/auth');
const practitionerAuth = require('../middleware/practitionerAuth');
const mongoose = require('mongoose');
const { getAssignedPatients } = require('../utils/practitionerPatients');

// Get all patients for a practitioner
router.get('/patients', auth, practitionerAuth, async (req, res) => {
    try {
        const patients = await getAssignedPatients(req.user._id);
        res.json({ success: true, patients });
    } catch (error) {
        console.error('Assigned patient list failed:', error.name);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Get detailed patient information including sessions and progress
router.get('/patients/:patientId', auth, practitionerAuth, async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.patientId)) return res.status(400).json({ success: false, message: 'Invalid patient id' });
        const patient = await User.findOne({ _id: req.params.patientId, userType: 'patient', assignedPractitioner: req.user._id })
          .select('name email phone profileImageUrl address personalDetails emergencyContact medicalHistory createdAt updatedAt status currentStage treatmentStartDate');
        if (!patient) {
            return res.status(404).json({ success: false, message: 'Patient not found' });
        }

        const [sessions, plans] = await Promise.all([
          TherapySession.find({ patient: req.params.patientId }).populate('practitioner', 'name').populate('treatmentPlan', 'status startDate therapies approval generatedAt').sort({ date: -1, startTime: -1 }).lean(),
          TreatmentPlan.find({ patient: req.params.patientId }).select('title status startDate createdAt doctor approval generatedAt therapies').sort({ createdAt: -1 }).lean(),
        ]);
        
        res.json({ 
            success: true, 
            patient,
            sessions,
            plans
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Update patient progress and milestones
router.put('/patients/:patientId/progress', auth, practitionerAuth, async (req, res) => {
    try {
        const { milestones, notes, recommendations, progress } = req.body;
        const patient = await User.findOne({ _id: req.params.patientId, userType: 'patient', assignedPractitioner: req.user._id });
        
        if (!patient) {
            return res.status(404).json({ success: false, message: 'Patient not found' });
        }

        if (progress !== undefined || milestones !== undefined) return res.status(400).json({ success: false, message: 'Progress is calculated from recorded therapy sessions and cannot be manually set' });
        if (notes !== undefined && (typeof notes !== 'string' || notes.length > 5000)) return res.status(400).json({ success: false, message: 'Notes must be 5000 characters or less' });
        if (recommendations !== undefined && (typeof recommendations !== 'string' || recommendations.length > 5000)) return res.status(400).json({ success: false, message: 'Recommendations must be 5000 characters or less' });
        if (notes !== undefined) patient.practitionerNotes = notes.trim();
        if (recommendations !== undefined) patient.recommendations = recommendations.trim();
        await patient.save();
        res.json({ success: true, message: 'Patient notes updated', patient: { _id: patient._id, practitionerNotes: patient.practitionerNotes, recommendations: patient.recommendations } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Add practitioner notes to a session
router.post('/sessions/:sessionId/notes', auth, practitionerAuth, async (req, res) => {
    try {
        const { notes, recommendations } = req.body;
        if (!mongoose.isValidObjectId(req.params.sessionId)) return res.status(400).json({ success: false, message: 'Invalid session id' });
        const session = await TherapySession.findOne({ _id: req.params.sessionId, practitioner: req.user._id });
        
        if (!session) {
            return res.status(404).json({ success: false, message: 'Session not found' });
        }

        // Verify the patient is assigned to this practitioner
        const patient = await User.findOne({ _id: session.patient, userType: 'patient', assignedPractitioner: req.user._id }).select('_id');
        if (!patient) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        session.practitionerNotes = {
            ...session.practitionerNotes,
            sessionNotes: notes
        };
        session.recommendations = recommendations;
        await session.save();

        res.json({ success: true, session });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
