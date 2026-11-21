import React, { useCallback, useEffect, useMemo, useState } from 'react';
import authFetch from '../../utils/apiClient';

const dateValue = (date) => { const now = new Date(date); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; };
const PractitionerFollowUps = ({ onSelectPatient }) => {
  const [items, setItems] = useState([]); const [patients, setPatients] = useState([]); const [filter, setFilter] = useState('pending'); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ patientId: '', dueAt: '', notes: '', sessionId: '', treatmentPlanId: '' });
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [followResponse, patientsResponse] = await Promise.all([authFetch('/api/follow-ups'), authFetch('/api/practitioner/patients')]);
      const [followData, patientsData] = await Promise.all([followResponse.json(), patientsResponse.json()]);
      if (!followResponse.ok) throw new Error(followData.message || 'Unable to load follow-ups');
      if (!patientsResponse.ok) throw new Error(patientsData.message || 'Unable to load assigned patients');
      setItems(followData.followUps || []); setPatients(patientsData.patients || []);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const today = dateValue(new Date());
  const filtered = useMemo(() => items.filter((item) => filter === 'all' || (filter === 'completed' ? item.status === 'completed' : item.status === 'pending' && (filter === 'overdue' ? dateValue(item.dueAt) < today : filter === 'today' ? dateValue(item.dueAt) === today : filter === 'upcoming' ? dateValue(item.dueAt) > today : true))), [items, filter, today]);
  const create = async (event) => {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try {
      const response = await authFetch('/api/follow-ups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const body = await response.json(); if (!response.ok) throw new Error(body.message || 'Follow-up could not be created');
      setNotice('Follow-up recorded and patient notified.'); setForm({ patientId: '', dueAt: '', notes: '', sessionId: '', treatmentPlanId: '' }); await load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };
  const complete = async (item) => {
    setSaving(true); setError(''); setNotice('');
    try { const response = await authFetch(`/api/follow-ups/${item._id}/complete`, { method: 'PATCH' }); const body = await response.json(); if (!response.ok) throw new Error(body.message || 'Follow-up could not be completed'); setNotice('Follow-up marked complete.'); await load(); }
    catch (e) { setError(e.message); } finally { setSaving(false); }
  };
  return <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 text-amber-950 sm:px-6"><header><h1 className="text-2xl font-semibold">Patient Follow-ups</h1><p className="mt-1 text-sm text-amber-800">Review due items, record follow-up instructions and track completion.</p></header>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}{notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-green-800">{notice}</p>}
    <form onSubmit={create} className="grid gap-3 rounded-xl border border-amber-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4"><h2 className="font-semibold sm:col-span-2 lg:col-span-4">Create follow-up</h2><label className="text-sm">Assigned patient<select required value={form.patientId} onChange={(event) => setForm({ ...form, patientId: event.target.value })} className="mt-1 block min-h-10 w-full rounded border border-amber-200 px-2"><option value="">Select a patient</option>{patients.map((patient) => <option key={patient._id} value={patient._id}>{patient.name} · {patient.email}</option>)}</select></label><label className="text-sm">Due date<input required type="date" min={today} value={form.dueAt} onChange={(event) => setForm({ ...form, dueAt: event.target.value })} className="mt-1 block min-h-10 w-full rounded border border-amber-200 px-2" /></label><label className="text-sm sm:col-span-2">Follow-up instructions<textarea required maxLength={3000} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} className="mt-1 block min-h-10 w-full rounded border border-amber-200 p-2" /></label><button disabled={saving || !patients.length} className="self-end rounded-lg bg-amber-700 px-4 py-2 text-sm text-white disabled:opacity-60">{saving ? 'Saving…' : 'Create follow-up'}</button></form>
    <section className="rounded-xl border border-amber-200 bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Follow-up history</h2><select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter follow-ups" className="rounded border border-amber-200 px-3 py-2 text-sm">{[['pending','Pending'],['today','Due today'],['upcoming','Upcoming'],['overdue','Overdue'],['completed','Completed'],['all','All']].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      {loading ? <p role="status" className="mt-3">Loading follow-ups…</p> : filtered.length ? <div className="mt-3 space-y-2">{filtered.map((item) => <article key={item._id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-100 bg-[#fffdf8] p-3"><div><p className="font-medium">{item.patient?.name || 'Assigned patient'} · {new Date(item.dueAt).toLocaleDateString()}</p><p className="mt-1 text-sm text-stone-700">{item.notes}</p><p className="mt-1 text-xs capitalize text-stone-600">{item.status}{item.session ? ` · ${item.session.sessionName || item.session.therapyType}` : ''}</p><button type="button" onClick={() => onSelectPatient?.(item.patient?._id)} className="mt-1 text-xs text-amber-800 underline">Open patient details</button></div>{item.status === 'pending' && <button type="button" disabled={saving} onClick={() => complete(item)} className="rounded border border-amber-300 px-3 py-2 text-sm disabled:opacity-60">Mark complete</button>}</article>)}</div> : <p className="mt-3 rounded-lg bg-amber-50 p-4 text-sm">No follow-ups match this filter.</p>}</section>
  </main>;
};
export default PractitionerFollowUps;
