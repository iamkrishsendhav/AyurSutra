const PHONE_PATTERN = /^\+?[0-9\s().-]{7,24}$/;
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown', ''];
const GENDERS = ['male', 'female', 'other', 'prefer_not_to_say', ''];
const HISTORY_LIST_FIELDS = ['conditions', 'medications', 'allergies', 'previousTreatments', 'previousSurgeries', 'primaryConcerns', 'treatmentGoals', 'patientReportedSymptoms'];
const ADDRESS_LIMITS = { street: 200, city: 100, state: 100, pincode: 20, country: 100 };

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isValidPhone = (value) => typeof value === 'string' && (!value.trim() || PHONE_PATTERN.test(value.trim()));

function validatePatientProfile(body, currentUser) {
  const errors = {};
  const updates = {};
  const addError = (field, message) => { errors[field] = message; };

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) addError('name', 'Enter your full name.');
    else if (body.name.trim().length > 120) addError('name', 'Name must be 120 characters or less.');
    else updates.name = body.name.trim();
  }

  if (body.phone !== undefined) {
    if (!isValidPhone(body.phone)) addError('phone', 'Enter a valid phone number.');
    else updates.phone = body.phone.trim();
  }

  if (body.profileImageUrl !== undefined) {
    if (typeof body.profileImageUrl !== 'string' || body.profileImageUrl.length > 2048 || (body.profileImageUrl && !/^https:\/\//i.test(body.profileImageUrl.trim()))) {
      addError('profileImageUrl', 'Use a valid HTTPS image URL.');
    } else updates.profileImageUrl = body.profileImageUrl.trim();
  }

  if (body.address !== undefined) {
    if (!isRecord(body.address)) addError('address', 'Enter a valid address.');
    else {
      const address = {};
      for (const [field, maxLength] of Object.entries(ADDRESS_LIMITS)) {
        const value = body.address[field] ?? currentUser.address?.[field] ?? (field === 'country' ? 'India' : '');
        if (typeof value !== 'string' || value.trim().length > maxLength) addError(`address.${field}`, `${field === 'pincode' ? 'Postal code' : field[0].toUpperCase() + field.slice(1)} must be ${maxLength} characters or less.`);
        else if (field === 'pincode' && value.trim() && !/^[A-Za-z0-9][A-Za-z0-9 -]{0,19}$/.test(value.trim())) addError('address.pincode', 'Enter a valid postal code.');
        else address[field] = value.trim();
      }
      if (!Object.keys(errors).some((field) => field.startsWith('address.'))) updates.address = address;
    }
  }

  if (body.personalDetails !== undefined) {
    if (!isRecord(body.personalDetails)) addError('personalDetails', 'Enter valid personal details.');
    else {
      const details = body.personalDetails;
      const dob = details.dateOfBirth ? new Date(details.dateOfBirth) : null;
      if (dob && (Number.isNaN(dob.getTime()) || dob > new Date())) addError('personalDetails.dateOfBirth', 'Date of birth must be a valid date in the past.');
      if (details.gender !== undefined && !GENDERS.includes(details.gender)) addError('personalDetails.gender', 'Choose a valid gender option.');
      if (details.bloodGroup !== undefined && !BLOOD_GROUPS.includes(details.bloodGroup)) addError('personalDetails.bloodGroup', 'Choose a valid blood group.');
      if (!Object.keys(errors).some((field) => field.startsWith('personalDetails'))) {
        updates.personalDetails = {
          dateOfBirth: details.dateOfBirth || null,
          gender: details.gender || '',
          bloodGroup: details.bloodGroup || '',
        };
      }
    }
  }

  if (body.caregiverPhone !== undefined) {
    if (!isValidPhone(body.caregiverPhone)) addError('caregiverPhone', 'Enter a valid alternate phone number.');
    else updates.caregiverPhone = body.caregiverPhone.trim();
  }

  if (body.emergencyContact !== undefined) {
    if (!isRecord(body.emergencyContact)) addError('emergencyContact', 'Enter a valid emergency contact.');
    else {
      const contact = body.emergencyContact;
      for (const [field, limit] of [['name', 120], ['phone', 30], ['relationship', 80]]) {
        if (contact[field] !== undefined && (typeof contact[field] !== 'string' || contact[field].trim().length > limit)) addError(`emergencyContact.${field}`, `${field[0].toUpperCase() + field.slice(1)} must be ${limit} characters or less.`);
      }
      if (contact.phone !== undefined && !isValidPhone(contact.phone)) addError('emergencyContact.phone', 'Enter a valid emergency contact phone number.');
      if (contact.name?.trim() && !contact.phone?.trim()) addError('emergencyContact.phone', 'Add a phone number for this emergency contact.');
      if (contact.phone?.trim() && !contact.name?.trim()) addError('emergencyContact.name', 'Add a name for this emergency contact.');
      if (!Object.keys(errors).some((field) => field.startsWith('emergencyContact.'))) {
        updates.emergencyContact = {
          name: (contact.name || '').trim(),
          phone: (contact.phone || '').trim(),
          relationship: (contact.relationship || '').trim(),
        };
      }
    }
  }

  if (body.medicalHistory !== undefined) {
    const history = body.medicalHistory;
    if (!isRecord(history)) addError('medicalHistory', 'Enter valid health information.');
    else {
      const currentHistory = currentUser.medicalHistory || {};
      const normalized = {};
      for (const field of HISTORY_LIST_FIELDS) {
        const values = history[field] ?? currentHistory[field] ?? [];
        const maxEntryLength = ['allergies', 'medications'].includes(field) ? 600 : 300;
        if (!Array.isArray(values) || values.length > 50 || values.some((value) => typeof value !== 'string' || value.trim().length > maxEntryLength)) {
          addError(`medicalHistory.${field}`, `Use up to 50 entries, each ${maxEntryLength} characters or less.`);
        } else normalized[field] = values.map((value) => value.trim()).filter(Boolean);
      }

      for (const [field, maxLength, label] of [['healthNotes', 5000, 'Health notes'], ['previousPanchakarma', 1000, 'Previous Panchakarma information']]) {
        const value = history[field] ?? currentHistory[field] ?? '';
        if (typeof value !== 'string' || value.length > maxLength) addError(`medicalHistory.${field}`, `${label} must be ${maxLength} characters or less.`);
        else normalized[field] = value.trim();
      }

      const lifestyle = history.lifestyle ?? currentHistory.lifestyle ?? {};
      if (!isRecord(lifestyle)) addError('medicalHistory.lifestyle', 'Enter valid lifestyle information.');
      else {
        const limits = { dietPreference: 100, activityLevel: 100, sleepPattern: 300, waterIntake: 100, notes: 2000 };
        normalized.lifestyle = {};
        for (const [field, maxLength] of Object.entries(limits)) {
          const value = lifestyle[field] ?? currentHistory.lifestyle?.[field] ?? '';
          if (typeof value !== 'string' || value.length > maxLength) addError(`medicalHistory.lifestyle.${field}`, `Must be ${maxLength} characters or less.`);
          else normalized.lifestyle[field] = value.trim();
        }
      }

      for (const [field, min, max, label] of [['heightCm', 30, 250, 'Height'], ['weightKg', 2, 500, 'Weight']]) {
        const raw = history[field] ?? currentHistory[field];
        if (raw === undefined || raw === null || raw === '') normalized[field] = null;
        else {
          const value = Number(raw);
          if (!Number.isFinite(value) || value < min || value > max) addError(`medicalHistory.${field}`, `${label} must be between ${min} and ${max}.`);
          else normalized[field] = value;
        }
      }

      if (!Object.keys(errors).some((field) => field.startsWith('medicalHistory'))) updates.medicalHistory = normalized;
    }
  }

  return { errors, updates };
}

module.exports = { validatePatientProfile, isValidPhone };
