import React, { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Camera, Check, ChevronRight, Heart, Loader2, MapPin, Phone, Plus, Save, Trash2, UserRound } from 'lucide-react';
import authFetch from '../../utils/apiClient';

const cardClass = 'rounded-2xl border border-amber-200/80 bg-white p-5 shadow-sm sm:p-6';
const inputClass = 'mt-1.5 min-h-11 w-full rounded-xl border border-stone-300 bg-white px-3.5 py-2.5 text-sm text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-amber-700 focus:ring-2 focus:ring-amber-700/15 disabled:bg-stone-50 disabled:text-stone-600';
const phonePattern = /^\+?[0-9\s().-]{7,24}$/;
const dateForInput = (value) => value ? new Date(value).toISOString().slice(0, 10) : '';

const emptyProfile = () => ({
  name: '', email: '', phone: '', profileImageUrl: '', caregiverPhone: '',
  address: { street: '', city: '', state: '', pincode: '', country: 'India' },
  personalDetails: { dateOfBirth: '', gender: '', bloodGroup: '' },
  emergencyContact: { name: '', phone: '', relationship: '' },
  medicalHistory: {
    heightCm: '', weightKg: '', conditions: [], previousSurgeries: [], allergies: [], medications: [],
    previousTreatments: [], primaryConcerns: [], treatmentGoals: [], patientReportedSymptoms: [],
    previousPanchakarma: '', healthNotes: '',
    lifestyle: { dietPreference: '', activityLevel: '', sleepPattern: '', waterIntake: '', notes: '' },
  },
});

const parseStructuredRows = (records, fieldNames) => (records || []).map((record) => {
  const pieces = String(record).split(' — ');
  const row = { name: pieces.shift() || '' };
  pieces.forEach((piece) => {
    const separator = piece.indexOf(':');
    if (separator < 0) return;
    const key = piece.slice(0, separator).trim().toLowerCase();
    const value = piece.slice(separator + 1).trim();
    const matched = fieldNames.find((field) => field.toLowerCase() === key);
    if (matched) row[matched] = value;
  });
  return row;
});

const serializeRows = (records, fieldNames) => records.filter((row) => String(row.name || '').trim()).map((row) => {
  const parts = [String(row.name || '').trim()];
  fieldNames.forEach((field) => { if (String(row[field] || '').trim()) parts.push(`${field}: ${String(row[field]).trim()}`); });
  return parts.join(' — ');
});

const normalizeProfile = (data = {}) => {
  const defaults = emptyProfile();
  const history = data.medicalHistory || {};
  return {
    ...defaults,
    name: data.name || '', email: data.email || '', phone: data.phone || '',
    profileImageUrl: data.profileImageUrl || '', caregiverPhone: data.caregiverPhone || '',
    address: { ...defaults.address, ...(data.address || {}) },
    personalDetails: {
      ...defaults.personalDetails,
      ...(data.personalDetails || {}),
      dateOfBirth: dateForInput(data.personalDetails?.dateOfBirth),
    },
    emergencyContact: { ...defaults.emergencyContact, ...(data.emergencyContact || {}) },
    medicalHistory: {
      ...defaults.medicalHistory,
      ...history,
      heightCm: history.heightCm ?? '',
      weightKg: history.weightKg ?? '',
      conditions: Array.isArray(history.conditions) ? history.conditions : [],
      previousSurgeries: Array.isArray(history.previousSurgeries) ? history.previousSurgeries : [],
      allergies: Array.isArray(history.allergies) ? history.allergies : [],
      medications: Array.isArray(history.medications) ? history.medications : [],
      previousTreatments: Array.isArray(history.previousTreatments) ? history.previousTreatments : [],
      primaryConcerns: Array.isArray(history.primaryConcerns) ? history.primaryConcerns : [],
      treatmentGoals: Array.isArray(history.treatmentGoals) ? history.treatmentGoals : [],
      patientReportedSymptoms: Array.isArray(history.patientReportedSymptoms) ? history.patientReportedSymptoms : [],
      lifestyle: { ...defaults.medicalHistory.lifestyle, ...(history.lifestyle || {}) },
    },
  };
};

function Field({ id, label, value, onChange, disabled, error, type = 'text', hint, ...props }) {
  return <div className="min-w-0">
    <label htmlFor={id} className="block text-sm font-medium text-stone-800">{label}</label>
    <input id={id} type={type} value={value ?? ''} onChange={onChange} disabled={disabled} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined} className={`${inputClass} ${error ? 'border-red-500 focus:border-red-600 focus:ring-red-600/15' : ''}`} {...props} />
    {error && <p id={`${id}-error`} className="mt-1.5 text-xs font-medium text-red-700">{error}</p>}
    {!error && hint && <p id={`${id}-hint`} className="mt-1.5 text-xs text-stone-500">{hint}</p>}
  </div>;
}

function TextArea({ id, label, value, onChange, disabled, error, hint, ...props }) {
  return <div className="min-w-0">
    <label htmlFor={id} className="block text-sm font-medium text-stone-800">{label}</label>
    <textarea id={id} value={value ?? ''} onChange={onChange} disabled={disabled} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined} className={`${inputClass} min-h-24 resize-y ${error ? 'border-red-500' : ''}`} {...props} />
    {error && <p id={`${id}-error`} className="mt-1.5 text-xs font-medium text-red-700">{error}</p>}
    {!error && hint && <p id={`${id}-hint`} className="mt-1.5 text-xs text-stone-500">{hint}</p>}
  </div>;
}

function PatientProfile({ user }) {
  const [profile, setProfile] = useState(emptyProfile);
  const [savedProfile, setSavedProfile] = useState(null);
  const [allergyRows, setAllergyRows] = useState([]);
  const [medicationRows, setMedicationRows] = useState([]);
  const [activeSection, setActiveSection] = useState('personal');
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('success');
  const [reloadKey, setReloadKey] = useState(0);
  const [photoFailed, setPhotoFailed] = useState(false);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setLoadError('');
    authFetch('/api/profile')
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.message || 'Unable to load your profile.');
        if (!current) return;
        const next = normalizeProfile(body);
        setProfile(next);
        setSavedProfile(next);
        setAllergyRows(parseStructuredRows(next.medicalHistory.allergies, ['Reaction', 'Notes']));
        setMedicationRows(parseStructuredRows(next.medicalHistory.medications, ['Dosage', 'Frequency', 'Notes']));
      })
      .catch((error) => { if (current) setLoadError(error.message || 'Unable to load your profile.'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [user?._id, reloadKey]);

  const setValue = (path, value) => {
    const parts = path.split('.');
    setProfile((current) => {
      const updated = { ...current };
      let cursor = updated;
      let source = current;
      parts.slice(0, -1).forEach((part) => { cursor[part] = { ...source[part] }; cursor = cursor[part]; source = source[part]; });
      cursor[parts.at(-1)] = value;
      return updated;
    });
    setFieldErrors((current) => { const next = { ...current }; delete next[path]; return next; });
    setMessage('');
  };

  const completionItems = useMemo(() => {
    const checks = [
      ['Full name', profile.name, 'personal'], ['Email address', profile.email, 'personal'], ['Phone number', profile.phone, 'personal'],
      ['Date of birth', profile.personalDetails.dateOfBirth, 'personal'], ['Gender', profile.personalDetails.gender, 'personal'],
      ['Street address', profile.address.street, 'personal'], ['City', profile.address.city, 'personal'], ['State', profile.address.state, 'personal'], ['Postal code', profile.address.pincode, 'personal'],
      ['Blood group', profile.personalDetails.bloodGroup, 'health'], ['Height', profile.medicalHistory.heightCm, 'health'], ['Weight', profile.medicalHistory.weightKg, 'health'],
      ['Emergency contact name', profile.emergencyContact.name, 'emergency'], ['Emergency contact phone', profile.emergencyContact.phone, 'emergency'],
    ];
    return checks.map(([label, value, section]) => ({ label, section, complete: String(value ?? '').trim().length > 0 }));
  }, [profile]);
  const completionPercent = Math.round(completionItems.filter((item) => item.complete).length / completionItems.length * 100);
  const incompleteItems = completionItems.filter((item) => !item.complete);

  const validate = () => {
    const errors = {};
    if (!profile.name.trim()) errors.name = 'Enter your full name.';
    else if (profile.name.trim().length > 120) errors.name = 'Name must be 120 characters or less.';
    if (profile.phone.trim() && !phonePattern.test(profile.phone.trim())) errors.phone = 'Enter a valid phone number.';
    if (profile.personalDetails.dateOfBirth && new Date(`${profile.personalDetails.dateOfBirth}T00:00:00`) > new Date()) errors['personalDetails.dateOfBirth'] = 'Date of birth must be in the past.';
    if (profile.profileImageUrl && !/^https:\/\//i.test(profile.profileImageUrl.trim())) errors.profileImageUrl = 'Use a secure HTTPS image URL.';
    if (profile.address.pincode && !/^[A-Za-z0-9][A-Za-z0-9 -]{0,19}$/.test(profile.address.pincode.trim())) errors['address.pincode'] = 'Enter a valid postal code.';
    if (profile.emergencyContact.phone.trim() && !phonePattern.test(profile.emergencyContact.phone.trim())) errors['emergencyContact.phone'] = 'Enter a valid emergency contact number.';
    if (profile.emergencyContact.name.trim() && !profile.emergencyContact.phone.trim()) errors['emergencyContact.phone'] = 'Add a phone number for this emergency contact.';
    if (profile.emergencyContact.phone.trim() && !profile.emergencyContact.name.trim()) errors['emergencyContact.name'] = 'Add a name for this emergency contact.';
    if (profile.caregiverPhone.trim() && !phonePattern.test(profile.caregiverPhone.trim())) errors.caregiverPhone = 'Enter a valid alternate phone number.';
    const height = profile.medicalHistory.heightCm;
    if (height !== '' && (!Number.isFinite(Number(height)) || Number(height) < 30 || Number(height) > 250)) errors['medicalHistory.heightCm'] = 'Enter a height between 30 and 250 cm.';
    const weight = profile.medicalHistory.weightKg;
    if (weight !== '' && (!Number.isFinite(Number(weight)) || Number(weight) < 2 || Number(weight) > 500)) errors['medicalHistory.weightKg'] = 'Enter a weight between 2 and 500 kg.';
    return errors;
  };

  const handleSave = async (event) => {
    event.preventDefault();
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      setMessage('Please correct the highlighted fields before saving.');
      setMessageType('error');
      const firstField = Object.keys(errors)[0];
      const section = firstField.startsWith('medicalHistory') || firstField.startsWith('personalDetails') ? 'health' : firstField.startsWith('emergencyContact') || firstField === 'caregiverPhone' ? 'emergency' : 'personal';
      setActiveSection(section);
      return;
    }

    const medicalHistory = {
      ...profile.medicalHistory,
      heightCm: profile.medicalHistory.heightCm === '' ? null : Number(profile.medicalHistory.heightCm),
      weightKg: profile.medicalHistory.weightKg === '' ? null : Number(profile.medicalHistory.weightKg),
      allergies: serializeRows(allergyRows, ['Reaction', 'Notes']),
      medications: serializeRows(medicationRows, ['Dosage', 'Frequency', 'Notes']),
    };
    const payload = {
      name: profile.name.trim(), phone: profile.phone.trim(), profileImageUrl: profile.profileImageUrl.trim(),
      address: profile.address, personalDetails: profile.personalDetails,
      emergencyContact: profile.emergencyContact, caregiverPhone: profile.caregiverPhone.trim(), medicalHistory,
    };

    setSaving(true);
    setMessage('');
    try {
      const response = await authFetch('/api/profile', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFieldErrors(body.errors || {});
        throw new Error(body.message || 'Your profile could not be saved.');
      }
      const next = normalizeProfile(body.user);
      setProfile(next);
      setSavedProfile(next);
      setAllergyRows(parseStructuredRows(next.medicalHistory.allergies, ['Reaction', 'Notes']));
      setMedicationRows(parseStructuredRows(next.medicalHistory.medications, ['Dosage', 'Frequency', 'Notes']));
      setIsEditing(false);
      setMessageType('success');
      setMessage('Your profile has been saved.');
      setFieldErrors({});
    } catch (error) {
      setMessageType('error');
      setMessage(error.message || 'Your profile could not be saved.');
    } finally { setSaving(false); }
  };

  const cancelEditing = () => {
    if (savedProfile) {
      setProfile(savedProfile);
      setAllergyRows(parseStructuredRows(savedProfile.medicalHistory.allergies, ['Reaction', 'Notes']));
      setMedicationRows(parseStructuredRows(savedProfile.medicalHistory.medications, ['Dosage', 'Frequency', 'Notes']));
    }
    setFieldErrors({});
    setMessage('');
    setIsEditing(false);
  };

  if (loading) return <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6 lg:px-8" role="status" aria-label="Loading patient profile"><div className="h-36 animate-pulse rounded-3xl bg-amber-100"/><div className="h-24 animate-pulse rounded-2xl bg-amber-100"/><div className="grid gap-5 lg:grid-cols-2"><div className="h-80 animate-pulse rounded-2xl bg-amber-100"/><div className="h-80 animate-pulse rounded-2xl bg-amber-100"/></div></main>;

  if (loadError) return <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6"><section className={cardClass} role="alert"><h1 className="text-xl font-semibold text-stone-900">Unable to load your profile</h1><p className="mt-2 text-sm text-stone-600">{loadError}</p><button type="button" onClick={() => setReloadKey((key) => key + 1)} className="mt-4 min-h-11 rounded-xl bg-amber-800 px-4 text-sm font-semibold text-white hover:bg-amber-900">Try again</button></section></main>;

  const sections = [
    { id: 'personal', label: 'Personal information', icon: UserRound },
    { id: 'health', label: 'Health profile', icon: Heart },
    { id: 'emergency', label: 'Emergency contact', icon: Phone },
  ];

  const updateRow = (setter, rows, index, field, value) => setter(rows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
  const removeRow = (setter, rows, index) => setter(rows.filter((_, rowIndex) => rowIndex !== index));

  return <main className="mx-auto max-w-6xl space-y-5 px-4 py-5 text-stone-900 sm:px-6 lg:px-8">
    <header className={`${cardClass} bg-gradient-to-br from-[#fffaf0] via-white to-orange-50`}>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-amber-100 text-amber-800">
            {profile.profileImageUrl && !photoFailed ? <img src={profile.profileImageUrl} alt={`${profile.name || 'Patient'} profile`} onError={() => setPhotoFailed(true)} className="h-full w-full object-cover" /> : <UserRound size={30} />}
          </div>
          <div><p className="text-xs font-bold uppercase tracking-[0.15em] text-amber-700">Patient profile</p><h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">My Profile</h1><p className="mt-1 text-sm text-stone-600">Manage your personal details and patient-reported health information.</p></div>
        </div>
        {!isEditing && <button type="button" onClick={() => { setIsEditing(true); setMessage(''); }} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-amber-800 px-4 text-sm font-semibold text-white transition hover:bg-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 focus-visible:ring-offset-2"><UserRound size={16}/>Edit profile</button>}
      </div>
    </header>

    <section className={cardClass} aria-label="Profile completion">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">Profile completeness</h2><p className="mt-1 text-sm text-stone-600">Based on key personal, contact, and health details.</p></div><strong className="text-2xl text-amber-800">{completionPercent}%</strong></div>
      <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-amber-100" role="progressbar" aria-valuenow={completionPercent} aria-valuemin="0" aria-valuemax="100" aria-label="Patient profile completion"><div className="h-full rounded-full bg-gradient-to-r from-amber-600 to-orange-600 transition-all duration-500" style={{ width: `${completionPercent}%` }}/></div>
      {incompleteItems.length > 0 ? <div className="mt-4"><p className="text-sm font-medium text-stone-800">Still to add</p><div className="mt-2 flex flex-wrap gap-2">{incompleteItems.map((item) => <button key={item.label} type="button" onClick={() => { setActiveSection(item.section); if (!isEditing) setIsEditing(true); }} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-amber-200 bg-[#FFFAF0] px-3 text-xs font-medium text-amber-900 hover:bg-amber-100">{item.label}<ChevronRight size={13}/></button>)}</div></div> : <p className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-emerald-800"><Check size={16}/>Key profile details are complete.</p>}
    </section>

    <nav aria-label="Profile sections" className="horizontal-scroll overflow-x-auto rounded-2xl">
      <div role="tablist" className="flex min-w-max gap-1 rounded-2xl border border-amber-200 bg-white p-1.5 shadow-sm">
        {sections.map(({ id, label, icon: Icon }) => <button key={id} type="button" role="tab" aria-selected={activeSection === id} onClick={() => setActiveSection(id)} className={`inline-flex min-h-10 items-center gap-2 rounded-xl px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 ${activeSection === id ? 'bg-amber-800 text-white' : 'text-amber-900 hover:bg-amber-50'}`}><Icon size={16}/>{label}</button>)}
      </div>
    </nav>

    {message && <p role={messageType === 'error' ? 'alert' : 'status'} className={`rounded-xl border p-3 text-sm ${messageType === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{message}</p>}

    <form onSubmit={handleSave} noValidate>
      {activeSection === 'personal' && <div className="space-y-5">
        <section className={cardClass}>
          <div className="mb-5 flex items-start gap-3"><span className="rounded-xl bg-amber-50 p-2.5 text-amber-800"><UserRound size={19}/></span><div><h2 className="text-lg font-semibold">Personal information</h2><p className="mt-1 text-sm text-stone-600">Your name and contact details used by the care team.</p></div></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="patient-name" label="Full name" value={profile.name} onChange={(event) => setValue('name', event.target.value)} disabled={!isEditing} autoComplete="name" maxLength={120} error={fieldErrors.name}/>
            <Field id="patient-email" label="Email address" value={profile.email} disabled type="email" autoComplete="email" hint="Email is linked to your sign-in and cannot be changed here."/>
            <Field id="patient-phone" label="Phone number" value={profile.phone} onChange={(event) => setValue('phone', event.target.value)} disabled={!isEditing} type="tel" autoComplete="tel" maxLength={24} error={fieldErrors.phone}/>
            <Field id="patient-dob" label="Date of birth" value={profile.personalDetails.dateOfBirth} onChange={(event) => setValue('personalDetails.dateOfBirth', event.target.value)} disabled={!isEditing} type="date" max={new Date().toISOString().slice(0, 10)} error={fieldErrors['personalDetails.dateOfBirth']}/>
            <div><label htmlFor="patient-gender" className="block text-sm font-medium text-stone-800">Gender</label><select id="patient-gender" value={profile.personalDetails.gender} onChange={(event) => setValue('personalDetails.gender', event.target.value)} disabled={!isEditing} className={inputClass}><option value="">Select if you wish</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option><option value="prefer_not_to_say">Prefer not to say</option></select>{fieldErrors['personalDetails.gender'] && <p className="mt-1.5 text-xs font-medium text-red-700">{fieldErrors['personalDetails.gender']}</p>}</div>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start">
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl bg-amber-50 text-amber-800">{profile.profileImageUrl && !photoFailed ? <img src={profile.profileImageUrl} alt="Patient profile" onError={() => setPhotoFailed(true)} className="h-full w-full object-cover"/> : <Camera size={26}/>}</div>
            <div><Field id="patient-photo-url" label="Profile photo URL" value={profile.profileImageUrl} onChange={(event) => { setPhotoFailed(false); setValue('profileImageUrl', event.target.value); }} disabled={!isEditing} type="url" placeholder="https://…" maxLength={2048} error={fieldErrors.profileImageUrl} hint="Secure image links are supported. File upload is not configured in this application."/></div>
          </div>
        </section>

        <section className={cardClass}>
          <div className="mb-5 flex items-start gap-3"><span className="rounded-xl bg-amber-50 p-2.5 text-amber-800"><MapPin size={19}/></span><div><h2 className="text-lg font-semibold">Home address</h2><p className="mt-1 text-sm text-stone-600">Your current address and postal details.</p></div></div>
          <div className="grid gap-4 sm:grid-cols-2"><Field id="address-street" label="Street address" value={profile.address.street} onChange={(event) => setValue('address.street', event.target.value)} disabled={!isEditing} maxLength={200} autoComplete="street-address" error={fieldErrors['address.street']}/><Field id="address-city" label="City" value={profile.address.city} onChange={(event) => setValue('address.city', event.target.value)} disabled={!isEditing} maxLength={100} autoComplete="address-level2" error={fieldErrors['address.city']}/><Field id="address-state" label="State" value={profile.address.state} onChange={(event) => setValue('address.state', event.target.value)} disabled={!isEditing} maxLength={100} autoComplete="address-level1" error={fieldErrors['address.state']}/><Field id="address-pincode" label="Postal code" value={profile.address.pincode} onChange={(event) => setValue('address.pincode', event.target.value)} disabled={!isEditing} maxLength={20} autoComplete="postal-code" error={fieldErrors['address.pincode']}/></div>
        </section>
      </div>}

      {activeSection === 'health' && <div className="space-y-5">
        <section className={cardClass}>
          <div className="mb-5 flex items-start gap-3"><span className="rounded-xl bg-amber-50 p-2.5 text-amber-800"><Activity size={19}/></span><div><h2 className="text-lg font-semibold">Physical information</h2><p className="mt-1 text-sm text-stone-600">Optional measurements entered by you. These are not clinical readings.</p></div></div>
          <div className="grid gap-4 sm:grid-cols-3"><div><label htmlFor="patient-blood-group" className="block text-sm font-medium text-stone-800">Blood group</label><select id="patient-blood-group" value={profile.personalDetails.bloodGroup} onChange={(event) => setValue('personalDetails.bloodGroup', event.target.value)} disabled={!isEditing} className={inputClass}><option value="">Not provided</option>{['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown'].map((group) => <option key={group} value={group}>{group}</option>)}</select>{fieldErrors['personalDetails.bloodGroup'] && <p className="mt-1.5 text-xs font-medium text-red-700">{fieldErrors['personalDetails.bloodGroup']}</p>}</div><Field id="patient-height" label="Height (cm)" value={profile.medicalHistory.heightCm} onChange={(event) => setValue('medicalHistory.heightCm', event.target.value)} disabled={!isEditing} type="number" min="30" max="250" step="0.1" error={fieldErrors['medicalHistory.heightCm']}/><Field id="patient-weight" label="Weight (kg)" value={profile.medicalHistory.weightKg} onChange={(event) => setValue('medicalHistory.weightKg', event.target.value)} disabled={!isEditing} type="number" min="2" max="500" step="0.1" error={fieldErrors['medicalHistory.weightKg']}/></div>
          <p className="mt-3 text-xs text-stone-500">Blood group is optional; height and weight are self-reported and should not be used as a diagnosis.</p>
        </section>

        <section className={cardClass}>
          <div className="mb-5"><h2 className="text-lg font-semibold">Medical history</h2><p className="mt-1 text-sm text-stone-600">Share relevant history with your care team. This section does not provide a diagnosis or treatment recommendation.</p></div>
          <div className="grid gap-4 sm:grid-cols-2"><TextArea id="health-conditions" label="Existing conditions" value={profile.medicalHistory.conditions.join(', ')} onChange={(event) => setValue('medicalHistory.conditions', event.target.value.split(',').map((value) => value.trim()).filter(Boolean))} disabled={!isEditing} maxLength={3000} hint="Separate multiple entries with commas." error={fieldErrors['medicalHistory.conditions']}/><TextArea id="health-surgeries" label="Previous surgeries" value={profile.medicalHistory.previousSurgeries.join(', ')} onChange={(event) => setValue('medicalHistory.previousSurgeries', event.target.value.split(',').map((value) => value.trim()).filter(Boolean))} disabled={!isEditing} maxLength={3000} hint="Include approximate dates if you know them." error={fieldErrors['medicalHistory.previousSurgeries']}/><TextArea id="health-history" label="Relevant medical history" value={profile.medicalHistory.healthNotes} onChange={(event) => setValue('medicalHistory.healthNotes', event.target.value)} disabled={!isEditing} maxLength={5000} error={fieldErrors['medicalHistory.healthNotes']}/><TextArea id="panchakarma-history" label="Previous Panchakarma experience" value={profile.medicalHistory.previousPanchakarma} onChange={(event) => setValue('medicalHistory.previousPanchakarma', event.target.value)} disabled={!isEditing} maxLength={1000} error={fieldErrors['medicalHistory.previousPanchakarma']}/></div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2"><TextArea id="health-treatments" label="Previous treatments" value={profile.medicalHistory.previousTreatments.join(', ')} onChange={(event) => setValue('medicalHistory.previousTreatments', event.target.value.split(',').map((value) => value.trim()).filter(Boolean))} disabled={!isEditing} maxLength={3000} hint="Separate multiple entries with commas." error={fieldErrors['medicalHistory.previousTreatments']}/><TextArea id="health-concerns" label="Primary concerns" value={profile.medicalHistory.primaryConcerns.join(', ')} onChange={(event) => setValue('medicalHistory.primaryConcerns', event.target.value.split(',').map((value) => value.trim()).filter(Boolean))} disabled={!isEditing} maxLength={3000} hint="Share concerns you want the care team to know." error={fieldErrors['medicalHistory.primaryConcerns']}/><TextArea id="health-goals" label="Treatment goals" value={profile.medicalHistory.treatmentGoals.join(', ')} onChange={(event) => setValue('medicalHistory.treatmentGoals', event.target.value.split(',').map((value) => value.trim()).filter(Boolean))} disabled={!isEditing} maxLength={3000} error={fieldErrors['medicalHistory.treatmentGoals']}/><TextArea id="health-symptoms" label="Symptoms to share" value={profile.medicalHistory.patientReportedSymptoms.join(', ')} onChange={(event) => setValue('medicalHistory.patientReportedSymptoms', event.target.value.split(',').map((value) => value.trim()).filter(Boolean))} disabled={!isEditing} maxLength={3000} error={fieldErrors['medicalHistory.patientReportedSymptoms']}/></div>
        </section>

        <section className={cardClass}>
          <div className="mb-4"><h2 className="text-lg font-semibold">Allergies</h2><p className="mt-1 text-sm text-stone-600">Record the allergy, the reaction you experienced, and any helpful notes.</p></div>
          {allergyRows.length === 0 && <p className="mb-3 rounded-xl bg-stone-50 p-3 text-sm text-stone-600">No allergies listed. Add an entry if applicable.</p>}
          <div className="space-y-3">{allergyRows.map((row, index) => <div key={`allergy-${index}`} className="grid gap-3 rounded-xl border border-amber-100 bg-[#FFFCF6] p-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"><Field id={`allergy-name-${index}`} label="Allergy" value={row.name} onChange={(event) => updateRow(setAllergyRows, allergyRows, index, 'name', event.target.value)} disabled={!isEditing} maxLength={180}/><Field id={`allergy-reaction-${index}`} label="Reaction" value={row.Reaction || ''} onChange={(event) => updateRow(setAllergyRows, allergyRows, index, 'Reaction', event.target.value)} disabled={!isEditing} maxLength={160}/><Field id={`allergy-notes-${index}`} label="Notes" value={row.Notes || ''} onChange={(event) => updateRow(setAllergyRows, allergyRows, index, 'Notes', event.target.value)} disabled={!isEditing} maxLength={160}/>{isEditing && <button type="button" aria-label={`Remove allergy ${index + 1}`} onClick={() => removeRow(setAllergyRows, allergyRows, index)} className="mb-1 inline-flex h-10 w-10 items-center justify-center rounded-lg text-stone-500 hover:bg-red-50 hover:text-red-700"><Trash2 size={17}/></button>}</div>)}</div>
          {isEditing && <button type="button" onClick={() => setAllergyRows((rows) => [...rows, { name: '', Reaction: '', Notes: '' }])} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border border-amber-300 px-3 text-sm font-medium text-amber-900 hover:bg-amber-50"><Plus size={16}/>Add allergy</button>}
          {fieldErrors['medicalHistory.allergies'] && <p className="mt-2 text-xs font-medium text-red-700">{fieldErrors['medicalHistory.allergies']}</p>}
        </section>

        <section className={cardClass}>
          <div className="mb-4"><h2 className="text-lg font-semibold">Current medications</h2><p className="mt-1 text-sm text-stone-600">List medicines you currently take, with the dosage and frequency if known.</p></div>
          {medicationRows.length === 0 && <p className="mb-3 rounded-xl bg-stone-50 p-3 text-sm text-stone-600">No current medications listed.</p>}
          <div className="space-y-3">{medicationRows.map((row, index) => <div key={`medicine-${index}`} className="grid gap-3 rounded-xl border border-amber-100 bg-[#FFFCF6] p-3 sm:grid-cols-2 lg:grid-cols-[1fr_0.8fr_0.8fr_1fr_auto] lg:items-end"><Field id={`medicine-name-${index}`} label="Medicine name" value={row.name} onChange={(event) => updateRow(setMedicationRows, medicationRows, index, 'name', event.target.value)} disabled={!isEditing} maxLength={180}/><Field id={`medicine-dosage-${index}`} label="Dosage" value={row.Dosage || ''} onChange={(event) => updateRow(setMedicationRows, medicationRows, index, 'Dosage', event.target.value)} disabled={!isEditing} maxLength={100}/><Field id={`medicine-frequency-${index}`} label="Frequency" value={row.Frequency || ''} onChange={(event) => updateRow(setMedicationRows, medicationRows, index, 'Frequency', event.target.value)} disabled={!isEditing} maxLength={100}/><Field id={`medicine-notes-${index}`} label="Notes" value={row.Notes || ''} onChange={(event) => updateRow(setMedicationRows, medicationRows, index, 'Notes', event.target.value)} disabled={!isEditing} maxLength={120}/>{isEditing && <button type="button" aria-label={`Remove medication ${index + 1}`} onClick={() => removeRow(setMedicationRows, medicationRows, index)} className="mb-1 inline-flex h-10 w-10 items-center justify-center rounded-lg text-stone-500 hover:bg-red-50 hover:text-red-700"><Trash2 size={17}/></button>}</div>)}</div>
          {isEditing && <button type="button" onClick={() => setMedicationRows((rows) => [...rows, { name: '', Dosage: '', Frequency: '', Notes: '' }])} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border border-amber-300 px-3 text-sm font-medium text-amber-900 hover:bg-amber-50"><Plus size={16}/>Add medication</button>}
          {fieldErrors['medicalHistory.medications'] && <p className="mt-2 text-xs font-medium text-red-700">{fieldErrors['medicalHistory.medications']}</p>}
        </section>

        <section className={cardClass}>
          <h2 className="text-lg font-semibold">Lifestyle</h2><p className="mt-1 text-sm text-stone-600">Optional details you choose to share with your care team.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2"><Field id="lifestyle-diet" label="Dietary preferences" value={profile.medicalHistory.lifestyle.dietPreference} onChange={(event) => setValue('medicalHistory.lifestyle.dietPreference', event.target.value)} disabled={!isEditing} maxLength={100}/><Field id="lifestyle-sleep" label="Sleep habits" value={profile.medicalHistory.lifestyle.sleepPattern} onChange={(event) => setValue('medicalHistory.lifestyle.sleepPattern', event.target.value)} disabled={!isEditing} maxLength={300}/><Field id="lifestyle-activity" label="Physical activity" value={profile.medicalHistory.lifestyle.activityLevel} onChange={(event) => setValue('medicalHistory.lifestyle.activityLevel', event.target.value)} disabled={!isEditing} maxLength={100}/><Field id="lifestyle-water" label="Water intake" value={profile.medicalHistory.lifestyle.waterIntake} onChange={(event) => setValue('medicalHistory.lifestyle.waterIntake', event.target.value)} disabled={!isEditing} maxLength={100}/><TextArea id="lifestyle-notes" label="Other lifestyle details" value={profile.medicalHistory.lifestyle.notes} onChange={(event) => setValue('medicalHistory.lifestyle.notes', event.target.value)} disabled={!isEditing} maxLength={2000}/></div>
        </section>
      </div>}

      {activeSection === 'emergency' && <section className={cardClass}>
        <div className="mb-5 flex items-start gap-3"><span className="rounded-xl bg-amber-50 p-2.5 text-amber-800"><Phone size={19}/></span><div><h2 className="text-lg font-semibold">Emergency contact</h2><p className="mt-1 text-sm text-stone-600">A person your care team can contact if needed. Add the name and phone together.</p></div></div>
        <div className="grid gap-4 sm:grid-cols-2"><Field id="emergency-name" label="Contact person" value={profile.emergencyContact.name} onChange={(event) => setValue('emergencyContact.name', event.target.value)} disabled={!isEditing} maxLength={120} error={fieldErrors['emergencyContact.name']}/><Field id="emergency-phone" label="Phone number" value={profile.emergencyContact.phone} onChange={(event) => setValue('emergencyContact.phone', event.target.value)} disabled={!isEditing} type="tel" maxLength={24} error={fieldErrors['emergencyContact.phone']}/><Field id="emergency-relationship" label="Relationship" value={profile.emergencyContact.relationship} onChange={(event) => setValue('emergencyContact.relationship', event.target.value)} disabled={!isEditing} maxLength={80} placeholder="For example, spouse or sibling"/><Field id="alternate-phone" label="Alternate contact phone (optional)" value={profile.caregiverPhone} onChange={(event) => setValue('caregiverPhone', event.target.value)} disabled={!isEditing} type="tel" maxLength={24} error={fieldErrors.caregiverPhone} hint="Uses the existing alternate caregiver phone field."/></div>
        <div className="mt-5 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-950"><AlertTriangle size={16} className="mt-0.5 shrink-0"/><p>Only share contact details with the patient’s permission. Emergency contact information is stored with the patient record and shown to authorized care staff.</p></div>
      </section>}

      {isEditing && <div className="sticky bottom-3 z-10 flex flex-wrap justify-end gap-2 rounded-2xl border border-amber-200 bg-white/95 p-3 shadow-lg backdrop-blur">
        <button type="button" onClick={cancelEditing} disabled={saving} className="min-h-11 rounded-xl border border-stone-300 px-4 text-sm font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-60">Cancel editing</button>
        <button type="submit" disabled={saving} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-800 px-5 text-sm font-semibold text-white hover:bg-amber-900 disabled:opacity-60">{saving ? <Loader2 size={16} className="animate-spin"/> : <Save size={16} />}{saving ? 'Saving…' : 'Save profile'}</button>
      </div>}
    </form>
  </main>;
}

export default PatientProfile;
