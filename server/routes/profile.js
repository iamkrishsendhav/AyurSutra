const express = require("express");
const router = express.Router();
const User = require("../models/User");
const auth = require("../middleware/auth");

// ======================
// Get User Profile
// ======================
router.get("/", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password -googleId");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json(user);
  } catch (err) {
    console.error("Get profile error:", err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// ======================
// Update User Profile
// ======================
router.put("/", auth, async (req, res) => {
  try {
  const {
    name,
    phone,
    address,
    caregiverPhone,
    emergencyContact,
    personalDetails,
    licenseNumber,
    // Practitioner-specific fields
    practiceLocation,
    practiceAreas,
    qualifications,
    profileImageUrl,
    availabilitySchedule,
    consultationFee,
    availableForNewPatients,
    bio,
    experience
  } = req.body;

    if (name !== undefined && (typeof name !== 'string' || name.trim().length > 120)) return res.status(400).json({ message: 'Name must be 120 characters or less' });
    if (phone !== undefined && (typeof phone !== 'string' || (phone && !/^\+?[0-9\s().-]{7,24}$/.test(phone)))) return res.status(400).json({ message: 'Enter a valid phone number' });
    for (const [field, value, limits] of [['address', address, { street: 200, city: 100, state: 100, pincode: 20, country: 100 }], ['emergency contact', emergencyContact, { name: 120, phone: 30, relationship: 80 }]]) {
      if (value === undefined) continue;
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.entries(limits).some(([key, max]) => value[key] !== undefined && (typeof value[key] !== 'string' || value[key].length > max))) return res.status(400).json({ message: `Invalid ${field}` });
    }
    if (personalDetails !== undefined) {
      const allowedGender = ['male', 'female', 'other', 'prefer_not_to_say', ''];
      const dob = personalDetails?.dateOfBirth ? new Date(personalDetails.dateOfBirth) : null;
      if (!personalDetails || typeof personalDetails !== 'object' || Array.isArray(personalDetails) || (dob && (Number.isNaN(dob.getTime()) || dob > new Date())) || (personalDetails.gender && !allowedGender.includes(personalDetails.gender))) return res.status(400).json({ message: 'Invalid personal details' });
    }

    // Build update object
    const updateData = {};
    
    if (name !== undefined) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;
    if (caregiverPhone !== undefined) updateData.caregiverPhone = caregiverPhone;
    if (licenseNumber !== undefined) updateData.licenseNumber = licenseNumber;
    
    // Practitioner-specific fields (only writable by practitioners)
  const currentUser = await User.findById(req.user._id);
    if (currentUser && currentUser.userType === 'practitioner') {
      if (practiceAreas !== undefined) updateData.practiceAreas = practiceAreas;
      if (qualifications !== undefined) updateData.qualifications = qualifications;
      if (profileImageUrl !== undefined) {
        if (typeof profileImageUrl !== 'string' || profileImageUrl.length > 2048 || (profileImageUrl && !/^https:\/\//i.test(profileImageUrl))) return res.status(400).json({ message: 'Profile image must be an HTTPS URL' });
        updateData.profileImageUrl = profileImageUrl;
      }
      if (availabilitySchedule !== undefined) {
        if (!Array.isArray(availabilitySchedule) || availabilitySchedule.length > 7) return res.status(400).json({ message: 'Invalid availability schedule' });
        updateData.availabilitySchedule = availabilitySchedule;
      }
      if (consultationFee !== undefined) updateData.consultationFee = consultationFee;
      if (availableForNewPatients !== undefined) updateData.availableForNewPatients = availableForNewPatients;
      if (bio !== undefined) updateData.bio = bio;
      if (experience !== undefined) updateData.experience = experience;
    }
    if (currentUser?.userType === 'receptionist' && profileImageUrl !== undefined) {
      if (typeof profileImageUrl !== 'string' || profileImageUrl.length > 2048 || (profileImageUrl && !/^https:\/\//i.test(profileImageUrl))) return res.status(400).json({ message: 'Profile image must be an HTTPS URL' });
      updateData.profileImageUrl = profileImageUrl;
    }

    if (currentUser?.userType === 'patient' && req.body.medicalHistory !== undefined) {
      const history = req.body.medicalHistory;
      const listFields = ['conditions', 'medications', 'allergies', 'previousTreatments', 'previousSurgeries', 'primaryConcerns', 'treatmentGoals', 'patientReportedSymptoms'];
      if (!history || typeof history !== 'object' || Array.isArray(history)) return res.status(400).json({ message: 'Invalid medical history' });
      const normalizedHistory = {};
      for (const field of listFields) {
        const values = history[field] ?? currentUser.medicalHistory?.[field] ?? [];
        if (!Array.isArray(values) || values.length > 50 || values.some((value) => typeof value !== 'string' || value.trim().length > 300)) {
          return res.status(400).json({ message: `Invalid ${field}` });
        }
        normalizedHistory[field] = values.map((value) => value.trim()).filter(Boolean);
      }
      const healthNotes = history.healthNotes ?? currentUser.medicalHistory?.healthNotes ?? '';
      if (typeof healthNotes !== 'string' || healthNotes.length > 5000) return res.status(400).json({ message: 'Health notes must be 5000 characters or less' });
      normalizedHistory.healthNotes = healthNotes.trim();
      const previousPanchakarma = history.previousPanchakarma ?? currentUser.medicalHistory?.previousPanchakarma ?? '';
      if (typeof previousPanchakarma !== 'string' || previousPanchakarma.length > 1000) return res.status(400).json({ message: 'Previous Panchakarma information must be 1000 characters or less' });
      normalizedHistory.previousPanchakarma = previousPanchakarma.trim();
      const lifestyle = history.lifestyle ?? currentUser.medicalHistory?.lifestyle ?? {};
      if (!lifestyle || typeof lifestyle !== 'object' || Array.isArray(lifestyle)) return res.status(400).json({ message: 'Invalid lifestyle information' });
      const limits = { dietPreference: 100, activityLevel: 100, sleepPattern: 300, waterIntake: 100, notes: 2000 };
      normalizedHistory.lifestyle = {};
      for (const [field, maxLength] of Object.entries(limits)) {
        const value = lifestyle[field] ?? currentUser.medicalHistory?.lifestyle?.[field] ?? '';
        if (typeof value !== 'string' || value.length > maxLength) return res.status(400).json({ message: `Invalid lifestyle ${field}` });
        normalizedHistory.lifestyle[field] = value.trim();
      }
      updateData.medicalHistory = normalizedHistory;
    }
    
    // Handle nested objects
    if (address) {
      updateData.address = {
        street: address.street || '',
        city: address.city || '',
        state: address.state || '',
        pincode: address.pincode || '',
        country: address.country || 'India'
      };
    }
    
    if (emergencyContact) {
      updateData.emergencyContact = {
        name: emergencyContact.name || '',
        phone: emergencyContact.phone || '',
        relationship: emergencyContact.relationship || ''
      };
    }
    
    if (personalDetails) {
      updateData.personalDetails = {
        dateOfBirth: personalDetails.dateOfBirth || null,
        gender: personalDetails.gender || '',
        bloodGroup: personalDetails.bloodGroup || ''
      };
    }
    
    // Handle practice location for practitioners
    if (practiceLocation) {
      updateData.practiceLocation = {
        address: practiceLocation.address || '',
        city: practiceLocation.city || '',
        state: practiceLocation.state || '',
        pincode: practiceLocation.pincode || '',
        country: practiceLocation.country || 'India',
        coordinates: {
          latitude: practiceLocation.coordinates?.latitude || null,
          longitude: practiceLocation.coordinates?.longitude || null
        }
      };
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select("-password -googleId");

    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    res.json({
      success: true,
      msg: "Profile updated successfully",
      user
    });
  } catch (err) {
    console.error("Update profile error:", err.message);
    res.status(500).json({ msg: 'Server error' });
  }
});

// ======================
// Get Profile by ID (for practitioners to view patient profiles)
// ======================
router.get("/:userId", auth, async (req, res) => {
  try {
    // Practitioner profile access is limited to patients assigned to that practitioner.
    if (req.user.userType !== 'practitioner') {
      return res.status(403).json({ msg: "Access denied. Practitioner access required." });
    }

    const user = await User.findOne({
      _id: req.params.userId,
      userType: 'patient',
      assignedPractitioner: req.user._id,
    }).select("-password -googleId");
    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    res.json(user);
  } catch (err) {
    console.error("Get user profile error:", err.message);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
