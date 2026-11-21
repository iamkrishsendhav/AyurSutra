const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const jwt = require("jsonwebtoken");
const config = require("../config/default.json");
const { getJwtSecret } = require('../config/jwt');
const passport = require("passport");
const { notifyAdmins } = require('../utils/notifications');
const authMiddleware = require('../middleware/auth');
const { isValidUserPassword } = require('../utils/passwordPolicy');

const defaultFrontendUrl = process.env.NODE_ENV === 'development'
  ? 'http://localhost:3000'
  : 'https://ayur-sutra-v6yp.vercel.app';
const frontendUrl = (process.env.CLIENT_URL || defaultFrontendUrl).replace(/\/$/, '');

// ======================
// Signup Route
// ======================
router.post("/signup", async (req, res) => {
  const { name, email, password, phone, gender, dateOfBirth, address } = req.body;

  try {
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 120) return res.status(400).json({ msg: 'Full name must be between 2 and 120 characters' });
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.length > 254) return res.status(400).json({ msg: 'Enter a valid email address' });
    if (!isValidUserPassword(password)) return res.status(400).json({ msg: 'Password must be between 6 and 128 characters' });
    if (phone !== undefined && (typeof phone !== 'string' || phone.length > 40)) return res.status(400).json({ msg: 'Invalid phone number' });
    if (gender !== undefined && !['male', 'female', 'other', 'prefer_not_to_say', ''].includes(gender)) return res.status(400).json({ msg: 'Invalid gender' });
    const normalizedEmail = email.trim().toLowerCase();
    if (dateOfBirth && (Number.isNaN(new Date(dateOfBirth).getTime()) || new Date(dateOfBirth) > new Date())) return res.status(400).json({ msg: 'Invalid date of birth' });
    // check if user already exists
    let existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ msg: "User already exists" });
    }

    // basic input validation
    // derive a fallback name if not provided
    let derivedName = name && String(name).trim();
    if (!derivedName && email) {
      const local = String(email).split("@")[0] || "user";
      derivedName = local
        .replace(/[._-]+/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
    }

    // create new user
    // Normalize phone: remove non-digit chars and try to format to E.164
    let phoneFormatted = null;
    if (phone) {
      const digits = String(phone).replace(/\D/g, "");
      if (digits.length === 10) {
        // assume local India number -> +91
        phoneFormatted = `+91${digits}`;
      } else if (digits.length === 11 && digits.startsWith("0")) {
        // leading 0, drop and assume +91
        phoneFormatted = `+91${digits.slice(1)}`;
      } else if (
        digits.length >= 11 &&
        digits.startsWith("91") &&
        digits.length <= 13
      ) {
        phoneFormatted = `+${digits}`;
      } else if (String(phone).startsWith("+")) {
        phoneFormatted = phone;
      } else {
        // fallback: keep raw input
        phoneFormatted = phone;
      }
    }

    const user = new User({
      name: derivedName,
      email: normalizedEmail,
      phone: phoneFormatted,
      userType: 'patient',
      ...(gender || dateOfBirth ? { personalDetails: { ...(gender ? { gender } : {}), ...(dateOfBirth ? { dateOfBirth: new Date(dateOfBirth) } : {}) } } : {}),
      ...(address && typeof address === 'object' && !Array.isArray(address) ? { address: { street: String(address.street || '').slice(0, 200), city: String(address.city || '').slice(0, 100), state: String(address.state || '').slice(0, 100), pincode: String(address.pincode || '').slice(0, 20), country: String(address.country || 'India').slice(0, 80) } } : {}),
    });

    // hash password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);

    // save user
    await user.save();
    await notifyAdmins('admin-update', 'New patient registration', 'A new patient account has registered.', { dedupeKey: `patient-registration:${user._id}` });

    res.json({
      success: true,
      msg: "User registered successfully",
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        userType: user.userType,
      },
    });
  } catch (err) {
    console.error("Signup error:", err.message);
    res.status(500).json({ msg: "Server error" });
  }
});

// ======================
// Login Route
// ======================
router.post("/login", async (req, res) => {
  const { email, password, expectedRole } = req.body;

  try {
    if (typeof email !== 'string' || typeof password !== 'string') return res.status(400).json({ msg: 'Email and password are required' });
    // find user
    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (!user) {
      return res.status(400).json({ msg: "User not found" });
    }

    // check password
    const isMatch = typeof user.password === 'string' && await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ msg: "Invalid credentials" });
    }
    if (user.accountStatus === 'suspended' || (user.userType === 'practitioner' && user.professionalStatus === 'inactive')) return res.status(403).json({ msg: 'This account is inactive. Contact the clinic administrator.' });
    if (expectedRole && expectedRole !== user.userType) return res.status(403).json({ msg: 'This account cannot sign in through the selected portal.' });

    // Sign JWT and return token + user info
    const payload = {
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        userType: user.userType,
      },
    };
    const token = jwt.sign(payload, getJwtSecret(), {
      expiresIn: process.env.JWT_EXPIRATION || config.jwtExpiration || "24h",
    });

    res.json({
      success: true,
      token,
      _id: user._id,
      name: user.name,
      email: user.email,
      userType: user.userType,
      mustChangePassword: Boolean(user.mustChangePassword),
    });
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ msg: "Server error" });
  }
});

router.post('/change-password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    if (typeof currentPassword !== 'string' || !isValidUserPassword(newPassword)) return res.status(400).json({ message: 'New password must be between 6 and 128 characters' });
    if (confirmPassword !== newPassword) return res.status(400).json({ message: 'Password confirmation does not match' });
    const user = await User.findById(req.user._id);
    if (!user?.password || !await bcrypt.compare(currentPassword, user.password)) return res.status(400).json({ message: 'Current password is incorrect' });
    user.password = await bcrypt.hash(newPassword, 12);
    user.mustChangePassword = false;
    await user.save();
    res.json({ success: true, mustChangePassword: false });
  } catch (_error) { res.status(500).json({ message: 'Password could not be updated' }); }
});

// ======================
// Get All Patients (for practitioners)
// ======================
router.get("/patients", authMiddleware, async (req, res) => {
  try {
    if (!['practitioner', 'admin'].includes(req.user.userType)) return res.status(403).json({ msg: 'Practitioner access required' });
    const filter = { userType: 'patient' };
    if (req.user.userType === 'practitioner') filter.assignedPractitioner = req.user._id;
    const patients = await User.find(filter).select(
      "name email _id"
    );
    res.json(patients);
  } catch (err) {
    console.error("Fetch patients error:", err.message);
    res.status(500).json({ msg: "Server error" });
  }
});

// ======================
// Get All Practitioners (for patients)
// ======================
router.get("/practitioners", authMiddleware, async (req, res) => {
  try {
    if (!['patient', 'practitioner', 'receptionist', 'admin'].includes(req.user.userType)) return res.status(403).json({ msg: 'Not authorized' });
    const practitioners = await User.find({ userType: 'practitioner', accountStatus: { $ne: 'suspended' }, professionalStatus: { $ne: 'inactive' } }).select(
      "name email _id phone"
    );
    res.json(practitioners);
  } catch (err) {
    console.error("Fetch practitioners error:", err.message);
    res.status(500).json({ msg: "Server error" });
  }
});

// ======================
// Google OAuth Routes
// ======================

// Google OAuth login initiation
router.get('/google', (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(503).json({ msg: 'Google login is not configured' });
  }
  return passport.authenticate("google", { scope: ["profile", "email"] })(req, res, next);
});

// Google OAuth callback
router.get(
  "/google/callback",
  (req, res, next) => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return res.redirect(`${frontendUrl}/login?error=google_auth_unavailable`);
    }
    return next();
  },
  passport.authenticate("google", {
    failureRedirect: `${frontendUrl}/login?error=google_auth_failed`,
  }),
  async (req, res) => {
    try {
      if (req.user.accountStatus === 'suspended' || (req.user.userType === 'practitioner' && req.user.professionalStatus === 'inactive')) {
        return res.redirect(`${frontendUrl}/?error=account_inactive`);
      }
      // Generate JWT token for the authenticated user
      const payload = {
        user: {
          _id: req.user._id,
          name: req.user.name,
          email: req.user.email,
          userType: req.user.userType,
        },
      };
      const token = jwt.sign(payload, getJwtSecret(), {
        expiresIn: process.env.JWT_EXPIRATION || config.jwtExpiration || "24h",
      });

      // Redirect to frontend with token and user data
      const userData = {
        _id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        userType: req.user.userType,
        provider: req.user.provider,
      };

      // Encode user data and token for URL
      const encodedUserData = encodeURIComponent(JSON.stringify(userData));
      const encodedToken = encodeURIComponent(token);

      res.redirect(
        `${frontendUrl}/#token=${encodedToken}&user=${encodedUserData}&auth=google`
      );
    } catch (error) {
      console.error("Google OAuth callback error:", error);
      res.redirect(`${frontendUrl}/login?error=google_auth_failed`);
    }
  }
);

// Google OAuth success endpoint (for API calls)
router.get("/google/success", (req, res) => {
  if (req.user && req.user.accountStatus !== 'suspended' && !(req.user.userType === 'practitioner' && req.user.professionalStatus === 'inactive')) {
    res.json({
      success: true,
      user: {
        _id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        userType: req.user.userType,
        provider: req.user.provider,
      },
    });
  } else {
    res.status(401).json({ success: false, message: "Not authenticated" });
  }
});

module.exports = router;
