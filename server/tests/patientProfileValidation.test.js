const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePatientProfile, isValidPhone } = require('../utils/patientProfileValidation');

const patient = {
  address: { street: '12 Main Road', city: 'Pune', state: 'Maharashtra', pincode: '411001', country: 'India' },
  medicalHistory: {
    conditions: ['Existing condition'], medications: ['Existing medicine'], allergies: ['Existing allergy'],
    previousSurgeries: [], previousTreatments: [], primaryConcerns: [], treatmentGoals: [], patientReportedSymptoms: [],
    lifestyle: { dietPreference: 'Vegetarian', activityLevel: '', sleepPattern: '', waterIntake: '', notes: '' },
  },
};

test('patient profile validation normalizes allowed profile fields and ignores email or clinical fields', () => {
  const { errors, updates } = validatePatientProfile({
    name: '  Meera Patel  ',
    email: 'changed@example.com',
    phone: '+91 98765 43210',
    profileImageUrl: 'https://images.example.test/meera.jpg',
    personalDetails: { dateOfBirth: '1990-01-02', gender: 'female', bloodGroup: 'O+' },
    medicalHistory: { ...patient.medicalHistory, heightCm: '164.5', weightKg: '58', allergies: ['Pollen — Reaction: Itching'], medications: ['Drug A — Dosage: 5 mg — Frequency: Daily'] },
    treatmentPlan: { status: 'approved' },
    clinicalRecord: { diagnosis: 'must not be accepted' },
  }, patient);

  assert.deepEqual(errors, {});
  assert.equal(updates.name, 'Meera Patel');
  assert.equal(updates.medicalHistory.heightCm, 164.5);
  assert.equal(updates.medicalHistory.weightKg, 58);
  assert.deepEqual(updates.medicalHistory.allergies, ['Pollen — Reaction: Itching']);
  assert.equal(Object.hasOwn(updates, 'email'), false);
  assert.equal(Object.hasOwn(updates, 'treatmentPlan'), false);
  assert.equal(Object.hasOwn(updates, 'clinicalRecord'), false);
});

test('patient profile validation reports field-level contact, measurement, and image errors', () => {
  const { errors } = validatePatientProfile({
    phone: 'not a phone',
    profileImageUrl: 'javascript:alert(1)',
    emergencyContact: { name: 'Asha', phone: 'bad', relationship: 'Sister' },
    caregiverPhone: 'bad',
    medicalHistory: { ...patient.medicalHistory, heightCm: 300, weightKg: 0 },
  }, patient);

  assert.ok(errors.phone);
  assert.ok(errors.profileImageUrl);
  assert.ok(errors['emergencyContact.phone']);
  assert.ok(errors.caregiverPhone);
  assert.ok(errors['medicalHistory.heightCm']);
  assert.ok(errors['medicalHistory.weightKg']);
});

test('patient profile preserves existing list fields and accepts blank optional emergency details', () => {
  const { errors, updates } = validatePatientProfile({
    emergencyContact: { name: '', phone: '', relationship: '' },
    medicalHistory: { heightCm: '', weightKg: '' },
  }, patient);

  assert.deepEqual(errors, {});
  assert.deepEqual(updates.emergencyContact, { name: '', phone: '', relationship: '' });
  assert.deepEqual(updates.medicalHistory.conditions, ['Existing condition']);
  assert.deepEqual(updates.medicalHistory.medications, ['Existing medicine']);
  assert.equal(updates.medicalHistory.heightCm, null);
  assert.equal(updates.medicalHistory.weightKg, null);
});

test('phone validation accepts an optional blank and rejects malformed values', () => {
  assert.equal(isValidPhone(''), true);
  assert.equal(isValidPhone('+1 (415) 555-0132'), true);
  assert.equal(isValidPhone('abc'), false);
});
