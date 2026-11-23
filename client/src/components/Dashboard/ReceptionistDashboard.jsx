import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, Clock, Search, UserPlus, Users, Eye, RefreshCw, Stethoscope } from 'lucide-react';
import authFetch from '../../utils/apiClient';
import ReceptionistTherapyScheduling from '../receptionist/ReceptionistTherapyScheduling';
import ReceptionistPatientProfile from '../receptionist/ReceptionistPatientProfile';
import ReceptionistWaitingQueue from '../receptionist/ReceptionistWaitingQueue';
import ReceptionistVaidyaSchedule from '../receptionist/ReceptionistVaidyaSchedule';
import ReceptionistReports from '../receptionist/ReceptionistReports';
import ReceptionistWaitlist from '../receptionist/ReceptionistWaitlist';
import ReceptionistAppointmentCalendar from '../receptionist/ReceptionistAppointmentCalendar';

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const shiftDay = (value, amount) => {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const calendarRange = (value, mode) => {
  if (mode === 'day') return { from: value, to: value };
  if (mode === 'week') {
    const weekday = new Date(`${value}T12:00:00`).getDay();
    const mondayOffset = (weekday + 6) % 7;
    const from = shiftDay(value, -mondayOffset);
    return { from, to: shiftDay(from, 6) };
  }
  const [year, month] = value.split('-').map(Number);
  return { from: `${year}-${String(month).padStart(2, '0')}-01`, to: `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}` };
};
const patientFormDefaults = { name: '', email: '', phone: '', password: '', gender: '', dateOfBirth: '' };
const contactDefaults = { name: '', phone: '', gender: '', dateOfBirth: '', address: { street: '', city: '', state: '', pincode: '', country: 'India' } };

export default function ReceptionistDashboard({ user, view, patientSearch = '', onPatientSearchChange }) {
  const [patients, setPatients] = useState([]);
  const [practitioners, setPractitioners] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [overview, setOverview] = useState(null);
  const [availableSlots, setAvailableSlots] = useState([]);
  const [availabilityVersion, setAvailabilityVersion] = useState(0);
  const [selectedWaitlistId, setSelectedWaitlistId] = useState('');
  const [therapyRefreshKey, setTherapyRefreshKey] = useState(0);
  const [rescheduleSlots, setRescheduleSlots] = useState([]);
  const [patientSort, setPatientSort] = useState('name');
  const [patientStatusFilter, setPatientStatusFilter] = useState('all');
  const [profilePatientId, setProfilePatientId] = useState('');
  const [date, setDate] = useState(today());
  const [calendarMode, setCalendarMode] = useState('day');
  const [patientForm, setPatientForm] = useState(patientFormDefaults);
  const [editingPatient, setEditingPatient] = useState(null);
  const [contactForm, setContactForm] = useState(contactDefaults);
  const [booking, setBooking] = useState({ patientId: '', practitionerId: '', slotId: '', therapyType: 'Consultation' });
  const [reschedulingId, setReschedulingId] = useState('');
  const [rescheduleForm, setRescheduleForm] = useState({ date: today(), newSlotId: '', reason: '' });
  const [cancellingId, setCancellingId] = useState('');
  const [cancellationReason, setCancellationReason] = useState('');
  const [appointmentFilters, setAppointmentFilters] = useState({ patientId: '', practitionerId: '', status: '' });
  const [showRegistration, setShowRegistration] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const appointmentRange = useMemo(() => calendarRange(date, calendarMode), [date, calendarMode]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [patientResponse, practitionerResponse, appointmentResponse, overviewResponse] = await Promise.all([
        authFetch(`/api/receptionist/patients?q=${encodeURIComponent(patientSearch)}`),
        authFetch('/api/receptionist/practitioners'),
        authFetch(`/api/receptionist/appointments?from=${appointmentRange.from}&to=${appointmentRange.to}`),
        authFetch('/api/receptionist/dashboard'),
      ]);
      const [patientBody, practitionerBody, appointmentBody, overviewBody] = await Promise.all([patientResponse.json(), practitionerResponse.json(), appointmentResponse.json(), overviewResponse.json()]);
      for (const [response, body] of [[patientResponse, patientBody], [practitionerResponse, practitionerBody], [appointmentResponse, appointmentBody], [overviewResponse, overviewBody]]) if (!response.ok) throw new Error(body.message || 'Reception workspace could not be loaded');
      setPatients(patientBody.patients || []); setPractitioners(practitionerBody.practitioners || []); setAppointments(appointmentBody.appointments || []); setOverview(overviewBody);
    } catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }, [appointmentRange.from, appointmentRange.to, date, patientSearch]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let active = true;
    let refreshing = false;
    const refreshQueue = async () => {
      if (refreshing || document.visibilityState !== 'visible') return;
      refreshing = true;
      try {
        const [appointmentsResponse, overviewResponse] = await Promise.all([
          authFetch(`/api/receptionist/appointments?from=${appointmentRange.from}&to=${appointmentRange.to}`),
          authFetch('/api/receptionist/dashboard'),
        ]);
        const [appointmentsBody, overviewBody] = await Promise.all([appointmentsResponse.json(), overviewResponse.json()]);
        if (!appointmentsResponse.ok || !overviewResponse.ok) throw new Error('Queue updates are temporarily unavailable');
        if (active) { setAppointments(appointmentsBody.appointments || []); setOverview(overviewBody); }
      } catch (_error) {
        // Keep the last successful queue visible during a temporary refresh failure.
      } finally { refreshing = false; }
    };
    const timer = setInterval(refreshQueue, 30000);
    return () => { active = false; clearInterval(timer); };
  }, [appointmentRange.from, appointmentRange.to]);
  useEffect(() => {
    const target = { 'reception-patients': 'receptionist-patients', 'reception-appointments': 'receptionist-booking', 'reception-checkin': 'receptionist-schedule', 'reception-availability': 'receptionist-availability', 'reception-reports': 'receptionist-reports', 'reception-therapy-scheduling': 'receptionist-therapy-scheduling' }[view];
    if (!target) return;
    requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [view]);

  useEffect(() => {
    let active = true;
    setAvailableSlots([]);
    if (!booking.practitionerId) return () => { active = false; };
    authFetch(`/therapy/available?practitionerId=${encodeURIComponent(booking.practitionerId)}`).then(async (response) => {
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Available slots could not be loaded');
      if (active) setAvailableSlots((Array.isArray(body) ? body : []).filter((slot) => new Date(slot.date).toISOString().slice(0, 10) === date));
    }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [booking.practitionerId, date, availabilityVersion]);

  useEffect(() => {
    let active = true;
    const appointment = appointments.find((item) => item._id === reschedulingId);
    setRescheduleSlots([]);
    if (!appointment?.practitioner?._id) return () => { active = false; };
    authFetch(`/therapy/available?practitionerId=${encodeURIComponent(appointment.practitioner._id)}`).then(async (response) => {
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Replacement slots could not be loaded');
      if (active) setRescheduleSlots((Array.isArray(body) ? body : []).filter((slot) => new Date(slot.date).toISOString().slice(0, 10) === rescheduleForm.date));
    }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [appointments, rescheduleForm.date, reschedulingId]);

  const createPatient = async (event) => {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try {
      const response = await authFetch('/api/receptionist/patients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patientForm) });
      const body = await response.json(); if (!response.ok) throw new Error(body.message || 'Patient could not be registered');
      setNotice(`Patient account created for ${body.patient.name}. Share initial access securely.`); setBooking((current) => ({ ...current, patientId: body.patient._id })); setPatientForm(patientFormDefaults); setShowRegistration(false); await load();
    } catch (requestError) { setError(requestError.message); }
    finally { setSaving(false); }
  };

  const bookAppointment = async (event) => {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try {
      const response = await authFetch('/api/receptionist/appointments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...booking, ...(selectedWaitlistId ? { waitlistId: selectedWaitlistId } : {}) }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.message || 'Appointment could not be booked');
      setNotice('Appointment booked successfully.'); setSelectedWaitlistId(''); setBooking((current) => ({ ...current, slotId: '' })); await load();
    } catch (requestError) { setError(requestError.message); }
    finally { setSaving(false); }
  };

  const savePatientContact = async (event) => {
    event.preventDefault(); if (!editingPatient) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await authFetch(`/api/receptionist/patients/${editingPatient._id}/contact`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(contactForm) });
      const body = await response.json(); if (!response.ok) throw new Error(body.message || 'Patient contact details could not be saved');
      setNotice('Patient contact and demographic details updated.'); setEditingPatient(null); await load();
    } catch (requestError) { setError(requestError.message); }
    finally { setSaving(false); }
  };

  const updateAppointment = async (appointmentId, action, reason = '') => {
    setError(''); setNotice('');
    try {
      const response = await authFetch(`/api/receptionist/appointments/${appointmentId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...(reason ? { reason } : {}) }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.message || 'Appointment could not be updated');
      setNotice(action === 'check-in' ? 'Patient checked in.' : action === 'call-next' ? 'Patient called from the waiting queue.' : 'Appointment updated.');
      if (action === 'cancel') setTherapyRefreshKey((value) => value + 1);
      await load(); return true;
    } catch (requestError) { setError(requestError.message); return false; }
  };

  const saveReschedule = async (event) => {
    event.preventDefault(); setError(''); setNotice('');
    try {
      const response = await authFetch(`/api/receptionist/appointments/${reschedulingId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reschedule', newSlotId: rescheduleForm.newSlotId, reason: rescheduleForm.reason }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.message || 'Appointment could not be rescheduled');
      setNotice('Appointment rescheduled. The previous time and reason were kept in appointment history.'); setReschedulingId(''); await load();
    } catch (requestError) { setError(requestError.message); }
  };

  const activePractitioners = useMemo(() => practitioners.filter((item) => item.accountStatus !== 'suspended' && item.professionalStatus !== 'inactive'), [practitioners]);
  const visiblePatients = useMemo(() => patients
    .filter((patient) => patientStatusFilter === 'all' || patient.accountStatus === patientStatusFilter)
    .sort((left, right) => patientSort === 'recent'
      ? new Date(right.createdAt || 0) - new Date(left.createdAt || 0)
      : String(left.name || '').localeCompare(String(right.name || ''))), [patients, patientSort, patientStatusFilter]);
  const filteredAppointments = useMemo(() => appointments.filter((item) => {
    const patientId = item.patient?._id || item.patient;
    const practitionerId = item.practitioner?._id || item.practitioner;
    return (!appointmentFilters.patientId || String(patientId) === appointmentFilters.patientId) &&
      (!appointmentFilters.practitionerId || String(practitionerId) === appointmentFilters.practitionerId) &&
      (!appointmentFilters.status || item.status === appointmentFilters.status);
  }), [appointments, appointmentFilters]);
  return <section className="space-y-6 text-amber-950">
    <header className="rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-5 sm:p-7"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-700">Reception desk</p><h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Welcome, {user?.name || 'Receptionist'}</h1><p className="mt-1 text-sm text-amber-800">Patient registration, appointment booking and today’s clinic schedule.</p></header>
    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"><span>{error}</span><button type="button" onClick={load} className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-3 py-1.5 font-medium"><RefreshCw className="h-3.5 w-3.5"/>Retry</button></div>}{notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[["Today's appointments", overview?.metrics?.todaysAppointments, CalendarDays], ['Upcoming appointments', overview?.metrics?.upcomingAppointments, Clock], ['Registered patients', overview?.totalRegisteredPatients, Users], ['New patients today', overview?.newPatientsToday, UserPlus], ['Checked in', overview?.metrics?.checkedInPatients, Check], ['Waiting queue', overview?.metrics?.waitingPatients, Clock], ['Completed consultations', overview?.metrics?.completedConsultations, Check], ['Cancelled appointments', overview?.metrics?.cancelledAppointments, CalendarDays], ['Missed appointments', overview?.metrics?.missedAppointments, Clock]].map(([label, value, Icon]) => <div key={label} className="as-card flex items-center gap-3 p-4"><Icon className="h-5 w-5 text-amber-700"/><div><p className="text-xs text-amber-700">{label}</p><p className="text-xl font-semibold">{loading ? '—' : value ?? 0}</p></div></div>)}</div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Clinic availability metrics">
      <div className="as-card flex items-center gap-3 rounded-2xl border border-amber-200 bg-white p-4 shadow-sm"><Stethoscope className="h-5 w-5 text-amber-700"/><div><p className="text-xs text-amber-700">Vaidyas available now</p><p className="text-xl font-semibold">{loading ? '—' : overview?.metrics?.currentlyAvailableVaidyas ?? 0}</p></div></div>
      <div className="as-card flex items-center gap-3 rounded-2xl border border-amber-200 bg-white p-4 shadow-sm"><CalendarDays className="h-5 w-5 text-amber-700"/><div><p className="text-xs text-amber-700">Therapy sessions today</p><p className="text-xl font-semibold">{loading ? '—' : overview?.metrics?.therapySessions ?? 0}</p></div></div>
    </div>
    <ReceptionistTherapyScheduling refreshKey={therapyRefreshKey} onScheduled={() => load()} />
    <ReceptionistVaidyaSchedule practitioners={practitioners} appointments={appointments} selectedDate={date} />
    <ReceptionistReports />
    <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
      <section id="receptionist-patients" className="as-card scroll-mt-6 space-y-4 rounded-2xl border border-amber-200 bg-white/95 p-5 shadow-sm sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-700">Patient services</p><h2 className="mt-1 text-lg font-semibold">Patient directory</h2><p className="text-sm text-amber-700">Contact and demographic details only. Each patient ID is unique.</p></div><button type="button" onClick={() => setShowRegistration((value) => !value)} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-amber-800 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"><UserPlus className="h-4 w-4"/>Register patient</button></div>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_11rem_11rem]">
          <label className="relative block"><Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-amber-700"/><span className="sr-only">Search patients</span><input value={patientSearch} onChange={(event) => onPatientSearchChange?.(event.target.value)} placeholder="Name, email, phone or patient ID" className="w-full rounded-xl border-amber-200 pl-9 focus:border-amber-600 focus:ring-amber-600"/></label>
          <label className="text-xs font-medium text-amber-800">Account status<select value={patientStatusFilter} onChange={(event) => setPatientStatusFilter(event.target.value)} className="mt-1 block w-full rounded-xl border-amber-200 bg-white px-3 py-2 text-sm"><option value="all">All patients</option><option value="active">Active</option><option value="suspended">Suspended</option></select></label>
          <label className="text-xs font-medium text-amber-800">Sort by<select value={patientSort} onChange={(event) => setPatientSort(event.target.value)} className="mt-1 block w-full rounded-xl border-amber-200 bg-white px-3 py-2 text-sm"><option value="name">Patient name</option><option value="recent">Recently registered</option></select></label>
        </div>
        {showRegistration && <form onSubmit={createPatient} className="grid gap-3 rounded-xl border border-amber-100 bg-amber-50/60 p-4 sm:grid-cols-2"><h3 className="font-semibold sm:col-span-2">Register a patient</h3><label className="text-sm">Full name<input required minLength="2" maxLength="120" value={patientForm.name} onChange={(event) => setPatientForm({ ...patientForm, name: event.target.value })} className="mt-1 block w-full"/></label><label className="text-sm">Email<input required type="email" value={patientForm.email} onChange={(event) => setPatientForm({ ...patientForm, email: event.target.value })} className="mt-1 block w-full"/></label><label className="text-sm">Phone<input value={patientForm.phone} onChange={(event) => setPatientForm({ ...patientForm, phone: event.target.value })} className="mt-1 block w-full"/></label><label className="text-sm">Gender<select value={patientForm.gender} onChange={(event) => setPatientForm({ ...patientForm, gender: event.target.value })} className="mt-1 block w-full"><option value="">Prefer not to say</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></label><label className="text-sm">Date of birth<input type="date" max={today()} value={patientForm.dateOfBirth} onChange={(event) => setPatientForm({ ...patientForm, dateOfBirth: event.target.value })} className="mt-1 block w-full"/></label><label className="text-sm">Initial password (6 to 128 characters; set with patient)<input required minLength="6" maxLength="128" type="password" autoComplete="new-password" value={patientForm.password} onChange={(event) => setPatientForm({ ...patientForm, password: event.target.value })} className="mt-1 block w-full"/></label><button disabled={saving} className="rounded-lg bg-amber-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60 sm:col-span-2">{saving ? 'Saving…' : 'Create patient account'}</button></form>}
        {editingPatient && <form onSubmit={savePatientContact} className="grid gap-3 rounded-xl border border-amber-100 bg-amber-50/60 p-4 sm:grid-cols-2"><h3 className="font-semibold sm:col-span-2">Edit {editingPatient.name} contact details</h3><label className="text-sm">Name<input required value={contactForm.name} onChange={(event) => setContactForm({ ...contactForm, name: event.target.value })} className="mt-1 block w-full"/></label><label className="text-sm">Phone<input value={contactForm.phone} onChange={(event) => setContactForm({ ...contactForm, phone: event.target.value })} className="mt-1 block w-full"/></label><label className="text-sm">Gender<select value={contactForm.gender} onChange={(event) => setContactForm({ ...contactForm, gender: event.target.value })} className="mt-1 block w-full"><option value="">Prefer not to say</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></label><label className="text-sm">Date of birth<input type="date" max={today()} value={contactForm.dateOfBirth} onChange={(event) => setContactForm({ ...contactForm, dateOfBirth: event.target.value })} className="mt-1 block w-full"/></label>{['street','city','state','pincode'].map((field) => <label key={field} className="text-sm capitalize">{field}<input value={contactForm.address[field] || ''} onChange={(event) => setContactForm({ ...contactForm, address: { ...contactForm.address, [field]: event.target.value } })} className="mt-1 block w-full"/></label>)}<div className="flex gap-2 sm:col-span-2"><button disabled={saving} className="rounded-lg bg-amber-700 px-3 py-2 text-sm text-white">{saving ? 'Saving…' : 'Save contact details'}</button><button type="button" onClick={() => setEditingPatient(null)} className="rounded-lg border border-amber-300 px-3 py-2 text-sm">Close</button></div></form>}
        {loading ? <div role="status" aria-label="Loading patient records" className="space-y-3">{[0, 1, 2, 3].map((item) => <div key={item} className="h-[4.5rem] animate-pulse rounded-xl bg-amber-50" />)}</div> : visiblePatients.length ? <ul className="max-h-[34rem] divide-y divide-amber-100 overflow-y-auto">{visiblePatients.map((patient) => <li key={patient._id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="truncate font-semibold text-amber-950">{patient.name}</p><p className="mt-0.5 break-all text-sm text-stone-600">{patient.email} · {patient.phone || 'No phone recorded'}</p><p className="mt-1 break-all font-mono text-[11px] text-amber-700">ID {patient._id}</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => setProfilePatientId(patient._id)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-50"><Eye className="h-3.5 w-3.5"/>Profile</button><button type="button" onClick={() => setBooking((current) => ({ ...current, patientId: patient._id }))} className={'min-h-9 rounded-lg border px-3 py-1.5 text-xs font-medium ' + (booking.patientId === patient._id ? 'border-amber-800 bg-amber-800 text-white' : 'border-amber-300 text-amber-900 hover:bg-amber-50')}>{booking.patientId === patient._id ? 'Selected' : 'Select'}</button><button type="button" onClick={() => { setEditingPatient(patient); setContactForm({ name: patient.name || '', phone: patient.phone || '', gender: patient.personalDetails?.gender || '', dateOfBirth: patient.personalDetails?.dateOfBirth ? new Date(patient.personalDetails.dateOfBirth).toISOString().slice(0, 10) : '', address: { ...contactDefaults.address, ...(patient.address || {}) } }); }} className="min-h-9 rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-50">Edit contact</button></div></li>)}</ul> : <p className="rounded-xl border border-dashed border-amber-300 bg-amber-50/50 p-6 text-center text-sm text-amber-800">{patientSearch ? 'No patients match this search. Check the name, email, phone or full patient ID.' : 'No patient records are available.'}</p>}
      </section>
      <div className="space-y-5"><section id="receptionist-booking" className="as-card space-y-4 p-5"><div><h2 className="text-lg font-semibold">Book an appointment</h2><p className="text-sm text-amber-700">Choose a published slot; patient and Vaidya booking uses the same availability source.</p></div><form onSubmit={bookAppointment} className="grid gap-3 sm:grid-cols-2"><label className="text-sm sm:col-span-2">Patient<select required value={booking.patientId} onChange={(event) => setBooking({ ...booking, patientId: event.target.value })} className="mt-1 block w-full"><option value="">Select patient</option>{patients.map((patient) => <option key={patient._id} value={patient._id}>{patient.name} — {patient.email}</option>)}</select></label><label className="text-sm">Vaidya / Practitioner<select required value={booking.practitionerId} onChange={(event) => setBooking({ ...booking, practitionerId: event.target.value, slotId: '' })} className="mt-1 block w-full"><option value="">Select practitioner</option>{activePractitioners.map((person) => <option key={person._id} value={person._id}>{person.name} · {person.practiceAreas?.join(', ') || 'General'}</option>)}</select></label><label className="text-sm">Appointment type<input required maxLength="120" value={booking.therapyType} onChange={(event) => setBooking({ ...booking, therapyType: event.target.value })} className="mt-1 block w-full"/></label><label className="text-sm sm:col-span-2">Published available slot<select required value={booking.slotId} onChange={(event) => setBooking({ ...booking, slotId: event.target.value })} className="mt-1 block w-full"><option value="">Select an available slot for {date}</option>{availableSlots.map((slot) => <option key={slot._id} value={slot._id}>{slot.startTime} · {slot.durationMins || 60} min</option>)}</select>{booking.practitionerId && !availableSlots.length && <span className="mt-1 block text-xs text-amber-800">No published slots are available on this date.</span>}</label><button disabled={saving || loading || !availableSlots.length} className="rounded-lg bg-amber-700 px-4 py-2.5 font-medium text-white disabled:opacity-60 sm:col-span-2">{saving ? 'Booking…' : 'Book appointment'}</button></form></section>
            <ReceptionistWaitlist date={date} patientId={booking.patientId} practitionerId={booking.practitionerId} therapyType={booking.therapyType} hasAvailableSlots={availableSlots.length > 0} selectedWaitlistId={selectedWaitlistId} refreshKey={availabilityVersion} onRefreshAvailability={() => setAvailabilityVersion((value) => value + 1)} onUseRequest={(entry) => { if (!entry) { setSelectedWaitlistId(""); return; } const requestedDate = new Date(entry.requestedDate).toISOString().slice(0, 10); setSelectedWaitlistId(entry._id); setDate(requestedDate); setBooking((current) => ({ ...current, patientId: entry.patient?._id || entry.patient, practitionerId: entry.practitioner?._id || entry.practitioner, therapyType: entry.therapyType, slotId: "" })); }} />
      <ReceptionistAppointmentCalendar appointments={filteredAppointments} date={date} mode={calendarMode} onDateChange={setDate} onModeChange={setCalendarMode} today={today()} />
      <section id="receptionist-schedule" className="as-card space-y-4 p-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold">Daily appointment schedule</h2><p className="text-sm text-amber-700">Check patients in, reschedule or cancel eligible appointments.</p></div><label className="text-sm">Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 block"/></label></div><div className="grid gap-3 sm:grid-cols-3"><label className="text-xs text-amber-800">Filter patient<select value={appointmentFilters.patientId} onChange={(event) => setAppointmentFilters({ ...appointmentFilters, patientId: event.target.value })} className="mt-1 block w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm"><option value="">All patients</option>{[...new Map(appointments.filter((item) => item.patient?._id).map((item) => [item.patient._id, item.patient])).values()].map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select></label><label className="text-xs text-amber-800">Filter Vaidya<select value={appointmentFilters.practitionerId} onChange={(event) => setAppointmentFilters({ ...appointmentFilters, practitionerId: event.target.value })} className="mt-1 block w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm"><option value="">All Vaidyas</option>{[...new Map(appointments.filter((item) => item.practitioner?._id).map((item) => [item.practitioner._id, item.practitioner])).values()].map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select></label><label className="text-xs text-amber-800">Filter status<select value={appointmentFilters.status} onChange={(event) => setAppointmentFilters({ ...appointmentFilters, status: event.target.value })} className="mt-1 block w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm"><option value="">All statuses</option>{['scheduled','confirmed','in-progress','completed','cancelled'].map((status) => <option key={status} value={status}>{status.replace('-', ' ')}</option>)}</select></label></div>{reschedulingId && <form onSubmit={saveReschedule} className="grid gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 sm:grid-cols-[1fr_1fr_auto_auto]"><label className="text-sm">New date<input required type="date" min={today()} value={rescheduleForm.date} onChange={(event) => setRescheduleForm({ date: event.target.value, newSlotId: '', reason: '' })} className="mt-1 block w-full"/></label><label className="text-sm">Published replacement slot<select required value={rescheduleForm.newSlotId} onChange={(event) => setRescheduleForm({ ...rescheduleForm, newSlotId: event.target.value })} className="mt-1 block w-full"><option value="">Select a slot</option>{rescheduleSlots.map((slot) => <option key={slot._id} value={slot._id}>{slot.startTime} · {slot.durationMins || 60} min</option>)}</select></label><label className="text-sm sm:col-span-2">Reason for rescheduling<textarea required minLength="3" maxLength="1000" value={rescheduleForm.reason} onChange={(event) => setRescheduleForm({ ...rescheduleForm, reason: event.target.value })} className="mt-1 block w-full rounded-lg border-amber-200" rows="2" /></label><button disabled={!rescheduleForm.newSlotId || rescheduleForm.reason.trim().length < 3} className="self-end rounded-lg bg-amber-700 px-3 py-2 text-sm text-white disabled:opacity-50">Save reschedule</button><button type="button" onClick={() => setReschedulingId('')} className="self-end rounded-lg border border-amber-300 px-3 py-2 text-sm">Close</button></form>}{loading ? <p role="status">Loading schedule…</p> : filteredAppointments.length ? <div className="max-h-96 space-y-2 overflow-y-auto">{filteredAppointments.map((appointment) => <article key={appointment._id} className="rounded-lg border border-amber-100 bg-amber-50/60 p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="flex items-center gap-2 font-semibold"><Clock className="h-4 w-4 text-amber-700"/>{appointment.startTime} · {new Date(appointment.date).toLocaleDateString()} · {appointment.patient?.name || 'Patient'}</p><p className="mt-1 text-sm text-gray-700">{appointment.sessionName || appointment.therapyType} · {appointment.practitioner?.name || 'Unassigned'}</p><p className="text-xs capitalize text-gray-600">{appointment.status}{appointment.checkedInAt ? ` · checked in ${new Date(appointment.checkedInAt).toLocaleTimeString()}` : ''}</p></div>{['scheduled','confirmed'].includes(appointment.status) && <div className="flex flex-wrap gap-2">{!appointment.checkedInAt && <button type="button" onClick={() => updateAppointment(appointment._id, 'check-in')} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs">Check in</button>}{!appointment.checkedInAt && <button type="button" onClick={() => { setReschedulingId(appointment._id); setRescheduleForm({ date: new Date(appointment.date).toISOString().slice(0, 10), newSlotId: '', reason: '' }); }} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs">Reschedule</button>}<button type="button" onClick={() => { setCancellingId(appointment._id); setCancellationReason(''); }} className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs text-red-700">Cancel</button></div>}</div></article>)}</div> : <p className="as-empty">No appointments match these filters for this date.</p>}</section></div>
    </div>
    <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]"><ReceptionistWaitingQueue appointments={overview?.todaysAppointments || []} onCallNext={(appointmentId) => updateAppointment(appointmentId, 'call-next')} /><section className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Next visits</p><h2 className="mt-1 font-semibold text-amber-950">Upcoming schedule</h2>{overview?.upcomingAppointments?.length ? <ul className="mt-3 divide-y divide-amber-100">{overview.upcomingAppointments.slice(0, 8).map((item) => <li key={item._id} className="flex justify-between gap-3 py-3 text-sm"><span className="min-w-0"><b className="block truncate">{item.patient?.name}</b><span className="text-xs text-amber-700">{item.practitioner?.name || 'Vaidya'}</span></span><span className="shrink-0 text-right text-xs text-amber-800">{new Date(item.date).toLocaleDateString()}<br/>{item.startTime}</span></li>)}</ul> : <p className="as-empty mt-3">No upcoming appointments are recorded.</p>}</section></div>
    {cancellingId && <div className="fixed inset-0 z-[110] flex items-center justify-center bg-stone-950/35 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setCancellingId(''); }}><form role="dialog" aria-modal="true" aria-labelledby="cancel-appointment-title" onSubmit={async (event) => { event.preventDefault(); const updated = await updateAppointment(cancellingId, 'cancel', cancellationReason); if (updated) setCancellingId(''); }} className="w-full max-w-lg space-y-4 rounded-2xl border border-amber-200 bg-white p-5 shadow-2xl"><div><h2 id="cancel-appointment-title" className="text-lg font-semibold text-amber-950">Cancel appointment</h2><p className="mt-1 text-sm text-amber-800">Record a reason for the patient and Vaidya history.</p></div><label className="block text-sm font-medium text-amber-900">Cancellation reason<textarea required minLength="3" maxLength="1000" value={cancellationReason} onChange={(event) => setCancellationReason(event.target.value)} rows="3" className="mt-1 block w-full rounded-lg border-amber-200" /></label><div className="flex justify-end gap-2"><button type="button" onClick={() => setCancellingId('')} className="rounded-lg border border-amber-300 px-3 py-2 text-sm">Keep appointment</button><button type="submit" disabled={cancellationReason.trim().length < 3} className="rounded-lg bg-red-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Confirm cancellation</button></div></form></div>}
    {profilePatientId && <ReceptionistPatientProfile patientId={profilePatientId} onClose={() => setProfilePatientId('')} />}
  </section>;
}
