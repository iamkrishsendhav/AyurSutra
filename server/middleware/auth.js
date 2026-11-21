const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../config/jwt');
const User = require('../models/User');

// Resolve authorization from the database on every request so role changes and
// suspended accounts take effect immediately instead of trusting stale JWT claims.
const auth = async (req, res, next) => {
  const token = req.header('x-auth-token');
  if (!token) return res.status(401).json({ success: false, message: 'Authentication required' });

  let decoded;
  try {
    decoded = jwt.verify(token, getJwtSecret());
  } catch (error) {
    if (error.code === 'JWT_SECRET_NOT_CONFIGURED') return res.status(503).json({ success: false, message: 'Authentication service is not configured' });
    return res.status(401).json({ success: false, message: 'Session is invalid or expired' });
  }

  const identity = decoded?.user?._id;
  if (!identity) return res.status(401).json({ success: false, message: 'Session is invalid or expired' });
  try {
    const user = await User.findById(identity).select('_id name email userType accountStatus mustChangePassword professionalStatus provider').lean();
    if (!user) return res.status(401).json({ success: false, message: 'Account is unavailable' });
    if (user.accountStatus === 'suspended' || (user.userType === 'practitioner' && user.professionalStatus === 'inactive')) {
      return res.status(403).json({ success: false, message: 'Account is inactive' });
    }
    const allowedDuringPasswordSetup = /\/(?:api\/)?(?:auth\/)?(?:profile|auth\/change-password|change-password)$/.test(req.originalUrl || '');
    if (user.mustChangePassword && !allowedDuringPasswordSetup) return res.status(403).json({ success: false, mustChangePassword: true, message: 'Set your personal password before using the application' });
    req.user = { ...user, _id: String(user._id) };
    return next();
  } catch (_error) {
    return res.status(503).json({ success: false, message: 'Authentication service is temporarily unavailable' });
  }
};

module.exports = auth;
