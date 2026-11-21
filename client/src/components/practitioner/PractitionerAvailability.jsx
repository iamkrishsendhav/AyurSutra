import React, { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import authFetch from '../../utils/apiClient';
import AvailabilityEditor from '../scheduling/AvailabilityEditor';

const PractitionerAvailability = ({ user }) => {
  const [schedule, setSchedule] = useState([]); const [acceptingPatients, setAcceptingPatients] = useState(true); const [date, setDate] = useState(''); const [times, setTimes] = useState('');
  const [slots, setSlots] = useState([]); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [profileResponse, sessionResponse] = await Promise.all([authFetch('/api/profile'), authFetch('/sessions')]);
      const [profile, sessionData] = await Promise.all([profileResponse.json(), sessionResponse.json()]);
      if (!profileResponse.ok) throw new Error(profile.message || 'Unable to load your profile');
      if (!sessionResponse.ok) throw new Error(sessionData.msg || 'Unable to load your schedule');
      setSchedule(profile.availabilitySchedule || []); setAcceptingPatients(profile.availableForNewPatients !== false);
      setSlots((Array.isArray(sessionData) ? sessionData : []).filter((item) => !item.patient || item.sessionName === 'General Slot'));
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const saveAvailability = async () => {
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await authFetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ availabilitySchedule: schedule, availableForNewPatients: acceptingPatients }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.message || body.msg || 'Availability could not be saved');
      setNotice('Working hours and patient availability saved.'); await load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };
  const publish = async (event) => {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try {
      const slotTimes = [...new Set(times.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean))];
      const response = await authFetch('/therapy/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, times: slotTimes }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Slots could not be published');
      setNotice('Consultation slots published. Patients can book these slots.'); setTimes(''); await load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };
  return <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 text-amber-950 sm:px-6"><header className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold">My Availability</h1><p className="mt-1 text-sm text-amber-800">Set recurring working hours and publish actual bookable consultation slots.</p></div><button onClick={load} className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm"><RefreshCw className="h-4 w-4"/>Refresh</button></header>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}{notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-green-800">{notice}</p>}
    <section className="rounded-xl border border-amber-200 bg-white p-5"><h2 className="font-semibold">Weekly working hours</h2>{loading ? <p role="status" className="mt-3">Loading availability…</p> : <><AvailabilityEditor value={schedule} onChange={setSchedule}/><label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={acceptingPatients} onChange={(event) => setAcceptingPatients(event.target.checked)}/>Accept new patient assignments and consultation requests</label><button onClick={saveAvailability} disabled={saving} className="mt-4 rounded-lg bg-amber-700 px-4 py-2 text-sm text-white disabled:opacity-60">{saving ? 'Saving…' : 'Save availability'}</button></>}</section>
    <section className="rounded-xl border border-amber-200 bg-white p-5"><h2 className="font-semibold">Publish consultation slots</h2><p className="mt-1 text-sm text-stone-600">The clinic’s booking hours, notice period, practitioner hours, session duration and overlap checks are applied by the server.</p><form onSubmit={publish} className="mt-3 grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end"><label className="text-sm">Date<input type="date" required min={new Date().toISOString().slice(0,10)} value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 block min-h-10 w-full rounded border border-amber-200 px-3" /></label><label className="text-sm">Start times (HH:MM, separated by spaces or commas)<input required value={times} onChange={(event) => setTimes(event.target.value)} placeholder="09:00, 10:00, 11:00" className="mt-1 block min-h-10 w-full rounded border border-amber-200 px-3" /></label><button disabled={saving || !user?._id} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-amber-700 px-4 text-sm text-white disabled:opacity-60"><Plus className="h-4 w-4"/>Publish</button></form></section>
    <section className="rounded-xl border border-amber-200 bg-white p-5"><h2 className="font-semibold">My schedule and published slots</h2>{loading ? <p className="mt-3">Loading sessions…</p> : slots.length ? <div className="mt-3 divide-y divide-amber-100">{slots.map((slot) => <article key={slot._id} className="flex flex-wrap items-center justify-between gap-2 py-3"><div><p className="font-medium">{slot.patient?.name || 'Open consultation slot'}</p><p className="text-sm text-stone-600">{new Date(slot.date).toLocaleDateString()} · {slot.startTime} · {slot.durationMins || 60} min · {slot.sessionName || slot.therapyType}</p></div><span className="rounded-full bg-amber-100 px-3 py-1 text-xs capitalize">{slot.patient ? slot.status : 'available'}</span></article>)}</div> : <p className="mt-3 rounded bg-amber-50 p-3 text-sm">No appointments or open slots are recorded.</p>}</section>
  </main>;
};
export default PractitionerAvailability;
