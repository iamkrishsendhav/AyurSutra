const allowedTransitions = {
  scheduled: ['confirmed', 'cancelled'],
  confirmed: ['in-progress', 'cancelled'],
  'in-progress': ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

function canTransition(from, to) {
  return Boolean(allowedTransitions[from]?.includes(to));
}

module.exports = { allowedTransitions, canTransition };
