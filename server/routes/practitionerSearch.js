const express = require("express");
const mongoose = require('mongoose');
const router = express.Router();
const User = require("../models/User");
const auth = require("../middleware/auth");
const { notifyUsers } = require('../utils/notifications');
const TherapySession = require('../models/TherapySession');
const { getClinicDateBounds } = require('../utils/clinicDate');

// ======================
// Search Practitioners
// ======================
router.get("/search", auth, async (req, res) => {
  try {
    const { city, state, pincode, practiceArea, q } = req.query;
    const user = await User.findById(req.user._id);

    // Allow both patients and practitioners (and admins if present) to search for practitioners.
    // Keep the restriction that only verified practitioners are returned and must be available for new patients.
    if (!user || !['patient', 'practitioner', 'admin'].includes(user.userType)) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Only registered patients or practitioners can search for practitioners.' 
      });
    }

    // Build search query
    let query = { userType: 'practitioner' };

    // By default, only show verified practitioners available for new patients.
    let requireVerified = true;
    let requireAvailable = true;

    // Allow practitioners or admins to request unverified results by passing includeUnverified=true
    // (useful for finding recently-updated profiles during testing). This is restricted to
    // requester roles 'practitioner' and 'admin' only.
    const includeUnverified = req.query.includeUnverified === 'true';
    if (includeUnverified && ['practitioner', 'admin'].includes(user.userType)) {
      requireVerified = false;
      // When includeUnverified is requested we still respect availableForNewPatients unless explicitly overridden
      if (req.query.includeUnavailable === 'true' && user.userType === 'admin') {
        requireAvailable = false;
      }
    }

    if (requireVerified) query.verificationStatus = 'verified';
    if (requireAvailable) query.availableForNewPatients = true;
    query.professionalStatus = { $ne: 'inactive' };
    query.accountStatus = { $ne: 'suspended' };
    const andFilters = [];
    const availableDate = req.query.availableDate;
    if (availableDate && !/^\d{4}-\d{2}-\d{2}$/.test(availableDate)) return res.status(400).json({ success: false, message: 'Choose a valid availability date.' });
    if (availableDate) {
      const date = new Date(`${availableDate}T00:00:00.000Z`);
      if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== availableDate) return res.status(400).json({ success: false, message: 'Choose a valid availability date.' });
      if (availableDate < getClinicDateBounds().date) return res.status(400).json({ success: false, message: 'Availability date cannot be in the past.' });
      const dayEnd = new Date(date); dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
      const publishedSlots = await TherapySession.find({
        isBooked: false, patient: null, status: 'scheduled', treatmentPlan: null,
        date: { $gte: date, $lt: dayEnd },
        $or: [{ sessionName: { $in: ['General Slot', 'Consultation Slot'] } }, { therapyType: { $in: ['Custom', 'Consultation'] } }],
      }).select('practitioner date startTime durationMins').populate('practitioner', 'availabilitySchedule').lean();
      const availablePractitioners = [...new Set(publishedSlots.filter((slot) => {
        const schedule = slot.practitioner?.availabilitySchedule || [];
        if (!schedule.length) return true;
        const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(slot.date).getUTCDay()];
        const hours = schedule.find((item) => item.dayOfWeek === dayName && item.isAvailable);
        if (!hours) return false;
        const minutes = (time) => { const [hour, minute] = String(time || '').split(':').map(Number); return hour * 60 + minute; };
        return minutes(slot.startTime) >= minutes(hours.startTime) && minutes(slot.startTime) + Number(slot.durationMins || 60) <= minutes(hours.endTime);
      }).map((slot) => slot.practitioner?._id?.toString()).filter(Boolean))];
      query._id = { $in: availablePractitioners };
    }
    const safeRegex = (value) => new RegExp(String(value).trim().slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    for (const [label, value] of [['city', city], ['state', state], ['postal code', pincode], ['specialization', practiceArea], ['search', q]]) {
      if (value !== undefined && (typeof value !== 'string' || value.length > 80)) return res.status(400).json({ success: false, message: `Invalid ${label} filter` });
    }
    if (q?.trim()) {
      const expression = safeRegex(q);
      andFilters.push({ $or: [{ name: expression }, { practiceAreas: expression }, { qualifications: expression }, { bio: expression }] });
    }

    // Add location filters. Match both practiceLocation.* and the user's address.* fields
    // to handle cases where practitioners filled address.city instead of practiceLocation.city
    if (city) {
      const expression = safeRegex(city);
      andFilters.push({ $or: [{ 'practiceLocation.city': expression }, { 'address.city': expression }] });
    }
    if (state) {
      const expression = safeRegex(state);
      andFilters.push({ $or: [{ 'practiceLocation.state': expression }, { 'address.state': expression }] });
    }
    if (pincode) {
      andFilters.push({ $or: [{ 'practiceLocation.pincode': pincode }, { 'address.pincode': pincode }] });
    }
    if (practiceArea) {
      const expression = safeRegex(practiceArea);
      andFilters.push({ $or: [{ practiceAreas: expression }, { qualifications: expression }] });
    }
    if (andFilters.length) query.$and = andFilters;

    // Find practitioners
    const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1));
    const pageSize = Math.max(1, Math.min(24, Number.parseInt(req.query.pageSize, 10) || 12));
    const sortKey = req.query.sort === 'experience' ? { experience: -1, name: 1 } : { name: 1 };
    const [count, practitioners] = await Promise.all([
      User.countDocuments(query),
      User.find(query)
        .select('name practiceLocation practiceAreas qualifications profileImageUrl availabilitySchedule consultationFee bio experience verificationStatus availableForNewPatients professionalStatus')
        .sort(sortKey).skip((page - 1) * pageSize).limit(pageSize).lean(),
    ]);

    // Debugging: include debugMatches array when requested by practitioners/admins, and always log constructed query
    let debugMatches = undefined;
    if (includeUnverified && ['practitioner', 'admin'].includes(user.userType)) {
      try {
        debugMatches = practitioners.map(p => ({ _id: p._id, name: p.name, city: p.practiceLocation?.city, state: p.practiceLocation?.state, verified: p.verificationStatus }));
        // Restricted diagnostic response is only available to staff callers.
      } catch (e) {
        console.error('Error building debugMatches:', e);
      }
    }

    const resp = {
      success: true,
      practitioners: practitioners,
      count,
      page,
      pageSize,
      totalPages: Math.ceil(count / pageSize),
    };
    if (debugMatches) resp.debugMatches = debugMatches;

    res.json(resp);

  } catch (err) {
    console.error("Search practitioners error:", err.message);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

// ======================
// Get Practitioner Details
// ======================
router.get("/:practitionerId", auth, async (req, res) => {
  try {
    const { practitionerId } = req.params;
    const user = await User.findById(req.user._id);

    // Allow authenticated patients and practitioners to view practitioner details
    if (!user || !['patient', 'practitioner', 'admin'].includes(user.userType)) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Only registered patients or practitioners can view practitioner details.' 
      });
    }

    if (!mongoose.isValidObjectId(practitionerId)) return res.status(400).json({ success: false, message: 'Invalid practitioner.' });
    const practitioner = await User.findOne({
      _id: practitionerId,
      userType: 'practitioner',
      verificationStatus: 'verified'
      , accountStatus: { $ne: 'suspended' }, professionalStatus: { $ne: 'inactive' }, availableForNewPatients: true
    }).select('name practiceLocation practiceAreas qualifications profileImageUrl availabilitySchedule consultationFee bio experience verificationStatus');

    if (!practitioner) {
      return res.status(404).json({ 
        success: false, 
        message: 'Practitioner not found' 
      });
    }

    res.json({
      success: true,
      practitioner: practitioner
    });

  } catch (err) {
    console.error("Get practitioner details error:", err.message);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

// ======================
// Assign Patient to Practitioner
// ======================
router.post("/assign", auth, async (req, res) => {
  try {
    const { practitionerId } = req.body;
    const user = await User.findById(req.user._id);

    if (user.userType !== 'patient') {
      return res.status(403).json({ 
        success: false, 
        message: 'Only patients can assign themselves to practitioners' 
      });
    }

    // Check if practitioner exists and is verified
    const practitioner = await User.findOne({
      _id: practitionerId,
      userType: 'practitioner',
      verificationStatus: 'verified',
      availableForNewPatients: true
    });

    if (!practitioner) {
      return res.status(404).json({ 
        success: false, 
        message: 'Practitioner not found or not available for new patients' 
      });
    }

    // Check if patient is already assigned
    if (user.assignedPractitioner) {
      return res.status(400).json({ 
        success: false, 
        message: 'You are already assigned to a practitioner. Please contact support to change your assignment.' 
      });
    }

    // Assign patient to practitioner
    user.assignedPractitioner = practitionerId;
    await user.save();
    await notifyUsers([user._id, practitioner._id], 'patient-assigned', 'Practitioner assignment updated', 'A patient has been assigned to your care team.', { dedupeKey: `patient-assigned:${user._id}:${practitioner._id}` });

    res.json({
      success: true,
      message: 'Successfully assigned to practitioner',
      practitioner: {
        _id: practitioner._id,
        name: practitioner.name,
      }
    });

  } catch (err) {
    console.error("Assign practitioner error:", err.message);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

// ======================
// Get Patient's Assigned Practitioner
// ======================
router.get("/assigned/current", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (user.userType !== 'patient') {
      return res.status(403).json({ 
        success: false, 
        message: 'Only patients can view their assigned practitioner' 
      });
    }

    if (!user.assignedPractitioner) {
      return res.json({
        success: true,
        assigned: false,
        message: 'No practitioner assigned'
      });
    }

    const practitioner = await User.findById(user.assignedPractitioner)
      .select('name practiceLocation practiceAreas consultationFee bio experience');

    if (!practitioner) {
      return res.status(404).json({ 
        success: false, 
        message: 'Assigned practitioner not found' 
      });
    }

    res.json({
      success: true,
      assigned: true,
      practitioner: practitioner
    });

  } catch (err) {
    console.error("Get assigned practitioner error:", err.message);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

// ======================
// Remove Patient Assignment
// ======================
router.delete("/assigned", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (user.userType !== 'patient') {
      return res.status(403).json({ 
        success: false, 
        message: 'Only patients can remove their practitioner assignment' 
      });
    }

    if (!user.assignedPractitioner) {
      return res.status(400).json({ 
        success: false, 
        message: 'No practitioner assigned' 
      });
    }

    user.assignedPractitioner = undefined;
    await user.save();

    res.json({
      success: true,
      message: 'Successfully removed practitioner assignment'
    });

  } catch (err) {
    console.error("Remove assignment error:", err.message);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

module.exports = router;
