function canManageSession(user, session) {
  if (!user || !session) return false;
  if (user.userType === 'admin') return true;
  if (user.userType === 'patient') return String(session.patient?._id || session.patient) === String(user._id);
  if (user.userType === 'practitioner') return String(session.practitioner?._id || session.practitioner) === String(user._id);
  return false;
}

function canCancelSession(user, session) {
  if (!canManageSession(user, session) || ['completed', 'cancelled'].includes(session.status)) return false;
  return user.userType !== 'patient' || session.status === 'scheduled';
}

module.exports = { canManageSession, canCancelSession };
