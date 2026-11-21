import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Search } from 'lucide-react';
import authFetch from '../../utils/apiClient';

const isConsultationSession = (session) => !session.treatmentPlan && (['Clinic Appointment', 'General Slot', 'Consultation Slot'].includes(session.sessionName) || ['Custom', 'Consultation', 'General Consultation'].includes(session.therapyType));
const PatientAppointments = () => {
  const [practitioners, setPractitioners] = useState([]);
  const [slots, setSlots] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [selectedPractitioner, setSelectedPractitioner] = useState('');
  const [confirmingSlot, setConfirmingSlot] = useState(null);
  const [editingAppointment, setEditingAppointment] = useState('');
  const [rescheduleDraft, setRescheduleDraft] = useState({ date: '', startTime: '' });
  const [query, setQuery] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadAppointments = useCallback(async () => {
    const response = await authFetch('/sessions');
    const body = await response.json();
    if (!response.ok) throw new Error(body.msg || 'Unable to load appointments');
    setAppointments((Array.isArray(body) ? body : body.sessions || []).filter(isConsultationSession));
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true); setError('');
      try {
        const [practitionerResponse, appointmentResponse] = await Promise.all([
          authFetch(`/api/practitioner-search/search?${new URLSearchParams(query.trim() ? { q: query.trim() } : {})}`),
          authFetch('/sessions'),
        ]);
        const [practitionerBody, appointmentBody] = await Promise.all([practitionerResponse.json(), appointmentResponse.json()]);
        if (!practitionerResponse.ok) throw new Error(practitionerBody.message || 'Unable to load practitioners');
        if (!appointmentResponse.ok) throw new Error(appointmentBody.msg || 'Unable to load appointments');
        if (active) {
          setPractitioners(practitionerBody.practitioners || []);
          setAppointments((Array.isArray(appointmentBody) ? appointmentBody : appointmentBody.sessions || []).filter(isConsultationSession));
        }
      } catch (e) { if (active) setError(e.message); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [query]);

  useEffect(() => {
    let active = true;
    (async () => {
      setError(''); setSlots([]);
      if (!selectedPractitioner) return;
      try {
        const response = await authFetch(`/therapy/available?practitionerId=${encodeURIComponent(selectedPractitioner)}`);
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Unable to load consultation slots');
        if (active) setSlots((Array.isArray(body) ? body : []).filter((slot) => slot.sessionName === 'General Slot' || slot.sessionName === 'Consultation Slot' || ['Custom', 'Consultation'].includes(slot.therapyType)));
      } catch (e) { if (active) setError(e.message); }
    })();
    return () => { active = false; };
  }, [selectedPractitioner]);

  const selectedName = useMemo(() => practitioners.find((item) => item._id === selectedPractitioner)?.name, [practitioners, selectedPractitioner]);
  const book = async (slot) => {
    setSaving(slot._id); setError(''); setNotice('');
    try {
      const response = await authFetch(`/therapy/book/${slot._id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Booking could not be completed');
      setNotice('Consultation booked. It is now listed under your appointments.');
      setReason(''); setSlots((items) => items.filter((item) => item._id !== slot._id)); await loadAppointments();
    } catch (e) { setError(e.message); }
    finally { setSaving(''); }
  };

  const updateAppointment = async (appointment, changes, successMessage) => {
    setSaving(appointment._id); setError(''); setNotice('');
    try {
      const response = await authFetch(`/sessions/${appointment._id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) });
      const body = await response.json(); if (!response.ok) throw new Error(body.msg || 'Appointment could not be updated');
      setNotice(successMessage); setEditingAppointment(''); await loadAppointments();
    } catch (e) { setError(e.message); }
    finally { setSaving(''); }
  };

  return <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 text-amber-950 sm:px-6">
    <header><h1 className="text-2xl font-semibold">Appointments</h1><p className="mt-1 text-sm text-amber-800">Find a verified Vaidya and book an available clinic consultation slot.</p></header>
    {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-green-800">{notice}</p>}{error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
    <section className="rounded-xl border border-amber-200 bg-white p-4 sm:p-5">
      <h2 className="font-semibold">Find a Vaidya</h2>
      <label className="mt-3 flex max-w-xl items-center gap-2 rounded-lg border border-amber-200 px-3"><Search className="h-4 w-4 text-amber-700" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, specialization or qualification" className="min-h-11 w-full outline-none" /></label>
      {loading ? <p role="status" className="mt-4">Loading Vaidyas…</p> : practitioners.length === 0 ? <p className="mt-4 rounded-lg bg-amber-50 p-4 text-sm">No active, verified Vaidyas matched this search.</p> : <div className="mt-4 grid gap-3 md:grid-cols-2">{practitioners.map((person) => <article key={person._id} className="rounded-lg border border-amber-100 bg-[#fffdf8] p-4">
        <div className="flex items-start gap-3">{person.profileImageUrl ? <img src={person.profileImageUrl} alt="" className="h-12 w-12 rounded-full object-cover" /> : <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 font-semibold text-amber-800">{person.name?.slice(0, 1) || 'V'}</div>}<div className="min-w-0 flex-1"><h3 className="font-medium">Vaidya {person.name}</h3><p className="text-sm text-stone-600">{[person.practiceLocation?.city, person.practiceLocation?.state].filter(Boolean).join(', ') || 'Clinic location not provided'}</p></div><span className="text-xs text-green-700">Verified</span></div>
        {person.qualifications?.length > 0 && <p className="mt-2 text-sm">{person.qualifications.join(' · ')}</p>}{person.practiceAreas?.length > 0 && <p className="mt-1 text-sm text-amber-800">{person.practiceAreas.join(' · ')}</p>}{person.bio && <p className="mt-2 text-sm text-stone-600">{person.bio}</p>}
        <div className="mt-3 flex items-center justify-between gap-2"><p className="text-xs text-stone-600">{person.experience ? `${person.experience} years experience` : 'Experience not listed'}{person.consultationFee > 0 ? ` · ₹${person.consultationFee}` : ''}</p><button type="button" onClick={() => setSelectedPractitioner(person._id)} className="rounded-lg bg-amber-700 px-3 py-2 text-sm text-white">View slots</button></div>
        {person.availabilitySchedule?.length > 0 && <p className="mt-2 text-xs text-stone-600">Availability: {person.availabilitySchedule.filter((item) => item.isAvailable).map((item) => `${item.dayOfWeek} ${item.startTime}–${item.endTime}`).join(', ') || 'Not currently listed'}</p>}
      </article>)}</div>}
      {selectedPractitioner && <div className="mt-5 rounded-lg bg-amber-50 p-4"><h3 className="font-semibold">Available consultation slots{selectedName ? ` · ${selectedName}` : ''}</h3><label className="mt-3 block max-w-xl text-sm">Reason for visit (optional)<input maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 min-h-10 w-full rounded border border-amber-200 bg-white px-3" /></label>{slots.length === 0 ? <p className="mt-3 text-sm text-stone-700">No bookable consultation slots are published for this Vaidya. Contact the clinic to request availability.</p> : <div className="mt-3 grid gap-2 sm:grid-cols-2">{slots.map((slot) => <div key={slot._id} className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-white p-3"><div><p className="text-sm font-medium">{new Date(slot.date).toLocaleDateString()} · {slot.startTime}</p><p className="text-xs text-stone-600">{slot.durationMins || 60} minutes · {slot.practitioner?.name || 'Vaidya'}</p></div><button type="button" onClick={() => setConfirmingSlot(slot)} disabled={Boolean(saving)} className="rounded-lg bg-amber-700 px-3 py-2 text-sm text-white disabled:opacity-60">Review booking</button></div>)}</div>}</div>}
    </section>
    <section className="rounded-xl border border-amber-200 bg-white p-4 sm:p-5"><h2 className="font-semibold">My appointments</h2>{loading ? <p className="mt-3 text-sm">Loading appointments…</p> : appointments.length === 0 ? <p className="mt-3 rounded-lg bg-amber-50 p-4 text-sm text-stone-700">No consultation appointments are recorded yet.</p> : <div className="mt-3 divide-y divide-amber-100">{appointments.map((item) => <article key={item._id} className="py-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="flex items-center gap-2 font-medium"><CalendarDays className="h-4 w-4 text-amber-700" />{new Date(item.date).toLocaleDateString()} · {item.startTime}</p><p className="text-sm text-stone-600">{item.practitioner?.name || 'Vaidya'} · {item.durationMins || 60} min</p></div><span className="rounded-full bg-amber-100 px-3 py-1 text-xs capitalize">{item.status}</span></div>{item.status === 'scheduled' && <div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={() => { setEditingAppointment(editingAppointment === item._id ? '' : item._id); setRescheduleDraft({ date: new Date(item.date).toISOString().slice(0,10), startTime: item.startTime }); }} className="rounded border border-amber-300 px-3 py-1.5 text-xs">Reschedule</button><button type="button" onClick={() => { if (window.confirm('Cancel this appointment?')) updateAppointment(item, { status: 'cancelled' }, 'Appointment cancelled.'); }} disabled={Boolean(saving)} className="rounded border border-red-200 px-3 py-1.5 text-xs text-red-700">Cancel</button></div>}{editingAppointment === item._id && <form onSubmit={(event) => { event.preventDefault(); updateAppointment(item, rescheduleDraft, 'Appointment rescheduled.'); }} className="mt-3 flex flex-wrap items-end gap-2 rounded-lg bg-amber-50 p-3"><label className="text-xs">Date<input type="date" required min={new Date().toISOString().slice(0,10)} value={rescheduleDraft.date} onChange={(event) => setRescheduleDraft({ ...rescheduleDraft, date: event.target.value })} className="mt-1 block rounded border border-amber-200 bg-white px-2 py-1.5" /></label><label className="text-xs">Time<input type="time" required value={rescheduleDraft.startTime} onChange={(event) => setRescheduleDraft({ ...rescheduleDraft, startTime: event.target.value })} className="mt-1 block rounded border border-amber-200 bg-white px-2 py-1.5" /></label><button disabled={Boolean(saving)} className="rounded bg-amber-700 px-3 py-2 text-xs text-white">{saving === item._id ? 'Saving…' : 'Confirm new time'}</button></form>}{item.status === 'confirmed' && <p className="mt-2 text-xs text-stone-600">For changes to a confirmed appointment, please contact the clinic.</p>}</article>)}</div>}</section>
    {confirmingSlot && <div role="dialog" aria-modal="true" aria-labelledby="booking-review-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setConfirmingSlot(null)}><section className="w-full max-w-md rounded-2xl bg-white p-5" onClick={(event) => event.stopPropagation()}><h2 id="booking-review-title" className="text-lg font-semibold">Review consultation</h2><p className="mt-3 text-sm">Vaidya {confirmingSlot.practitioner?.name || selectedName}</p><p className="text-sm">{new Date(confirmingSlot.date).toLocaleDateString()} · {confirmingSlot.startTime} · {confirmingSlot.durationMins || 60} minutes</p>{reason.trim() && <p className="mt-2 text-sm">Reason: {reason.trim()}</p>}<p className="mt-3 text-xs text-stone-600">Booking will be confirmed only if the slot remains available.</p><div className="mt-4 flex justify-end gap-2"><button onClick={() => setConfirmingSlot(null)} className="rounded-lg border px-3 py-2 text-sm">Back</button><button onClick={async () => { const slot = confirmingSlot; setConfirmingSlot(null); await book(slot); }} disabled={Boolean(saving)} className="rounded-lg bg-amber-700 px-4 py-2 text-sm text-white">Confirm booking</button></div></section></div>}
  </main>;
};

export default PatientAppointments;
