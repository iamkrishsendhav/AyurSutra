import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, ClipboardList, RefreshCw } from 'lucide-react';
import authFetch from '../../utils/apiClient';

const statusActions = {
  scheduled: ['confirmed', 'cancelled'],
  confirmed: ['in-progress', 'cancelled'],
  'in-progress': ['completed', 'cancelled'],
};
const sameDay = (value) => new Date(value).toLocaleDateString() === new Date().toLocaleDateString();
const dateInput = (value) => value ? new Date(value).toISOString().slice(0, 10) : '';

export default function SessionOperations({ user, userType }) {
  const [sessions, setSessions] = useState([]);
  const [followUps, setFollowUps] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [record, setRecord] = useState({ observations: '', treatmentNotes: '', completionRemarks: '', followUpRecommendations: '' });
  const [feedback, setFeedback] = useState({ rating: 5, comments: '' });
  const [followUpForm, setFollowUpForm] = useState({ dueAt: '', notes: '', sessionId: '', treatmentPlanId: '' });

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [sessionResponse, followResponse] = await Promise.all([authFetch('/sessions'), authFetch('/api/follow-ups')]);
      const sessionBody = await sessionResponse.json();
      const followBody = await followResponse.json();
      if (!sessionResponse.ok) throw new Error(sessionBody.msg || 'Unable to load sessions');
      setSessions(Array.isArray(sessionBody) ? sessionBody : sessionBody.sessions || []);
      if (followResponse.ok) setFollowUps(followBody.followUps || []);
    } catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!selected) return;
    setRecord({ observations: selected.clinicalRecord?.observations || '', treatmentNotes: selected.clinicalRecord?.treatmentNotes || '', completionRemarks: selected.clinicalRecord?.completionRemarks || '', followUpRecommendations: selected.clinicalRecord?.followUpRecommendations || '' });
  }, [selected]);

  const filtered = useMemo(() => sessions.filter((session) => {
    const matchesStatus = statusFilter === 'all' || (statusFilter === 'today' ? sameDay(session.date) : statusFilter === 'upcoming' ? new Date(session.date) >= new Date(new Date().setHours(0, 0, 0, 0)) && ['scheduled', 'confirmed'].includes(session.status) : session.status === statusFilter);
    const haystack = `${session.patient?.name || ''} ${session.patient?.email || ''} ${session.sessionName || ''} ${session.therapyType || ''}`.toLowerCase();
    return matchesStatus && haystack.includes(query.toLowerCase().trim());
  }), [sessions, statusFilter, query]);

  const updateStatus = async (session, status) => {
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await authFetch(`/sessions/${session._id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.msg || 'Session could not be updated');
      setNotice(`Session marked ${status}.`); setSelected(body.session || session); await load();
    } catch (requestError) { setError(requestError.message); } finally { setSaving(false); }
  };

  const saveRecord = async (event) => {
    event.preventDefault(); if (!selected) return; setSaving(true); setError(''); setNotice('');
    try {
      const response = await authFetch(`/sessions/${selected._id}/clinical-record`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record) });
      const body = await response.json(); if (!response.ok) throw new Error(body.msg || 'Clinical record could not be saved');
      setSelected(body.session); setNotice('Session notes saved.'); await load();
    } catch (requestError) { setError(requestError.message); } finally { setSaving(false); }
  };

  const submitFeedback = async (event) => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const response = await authFetch(`/sessions/${selected._id}/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(feedback) });
      const body = await response.json(); if (!response.ok) throw new Error(body.msg || 'Feedback could not be submitted');
      setNotice('Thank you. Your feedback has been recorded.'); setSelected({ ...selected, feedback: body.feedback }); await load();
    } catch (requestError) { setError(requestError.message); } finally { setSaving(false); }
  };

  const createFollowUp = async (event) => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const response = await authFetch('/api/follow-ups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ patientId: selected.patient?._id || selected.patient, sessionId: selected._id, practitionerId: selected.practitioner?._id || selected.practitioner, ...followUpForm }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.message || 'Follow-up could not be created');
      setNotice('Follow-up created.'); setFollowUpForm({ dueAt: '', notes: '', sessionId: '', treatmentPlanId: '' }); await load();
    } catch (requestError) { setError(requestError.message); } finally { setSaving(false); }
  };

  const completeFollowUp = async (id) => {
    const response = await authFetch(`/api/follow-ups/${id}/complete`, { method: 'PATCH' });
    const body = await response.json(); if (!response.ok) setError(body.message || 'Follow-up could not be completed'); else { setNotice('Follow-up completed.'); await load(); }
  };

  const upcoming = sessions.filter((item) => ['scheduled', 'confirmed'].includes(item.status) && new Date(item.date) >= new Date(new Date().setHours(0, 0, 0, 0))).length;
  const completed = sessions.filter((item) => item.status === 'completed').length;
  const today = sessions.filter((item) => sameDay(item.date) && !['cancelled'].includes(item.status)).length;
  const weekEnd = new Date(); weekEnd.setDate(weekEnd.getDate() + 7);
  const week = sessions.filter((item) => ['scheduled', 'confirmed'].includes(item.status) && new Date(item.date) >= new Date() && new Date(item.date) <= weekEnd).length;
  const pendingFollowUps = followUps.filter((item) => item.status === 'pending').length;

  return <main className="space-y-5 rounded-2xl border border-amber-100 bg-[#FDF7E9] p-5 text-amber-950 sm:p-7">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">{userType === 'practitioner' ? 'Therapy Operations Workspace' : userType === 'patient' ? 'My Treatment Sessions' : 'Session Operations'}</h1><p className="text-sm text-gray-600">Sessions, progress history, clinical notes and follow-up actions.</p></div><button onClick={load} className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-2"><RefreshCw className="h-4 w-4" />Refresh</button></header>
    {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-green-800">{notice}</p>}{error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><div className="rounded-xl border border-amber-100 bg-white p-4"><p className="text-sm text-gray-600">Total sessions</p><strong className="text-2xl">{sessions.length}</strong></div><div className="rounded-xl border border-amber-100 bg-white p-4"><p className="text-sm text-gray-600">Today</p><strong className="text-2xl">{today}</strong></div><div className="rounded-xl border border-amber-100 bg-white p-4"><p className="text-sm text-gray-600">Next 7 days</p><strong className="text-2xl">{week}</strong></div><div className="rounded-xl border border-amber-100 bg-white p-4"><p className="text-sm text-gray-600">Upcoming</p><strong className="text-2xl">{upcoming}</strong></div><div className="rounded-xl border border-amber-100 bg-white p-4"><p className="text-sm text-gray-600">Completed · pending follow-ups</p><strong className="text-2xl">{completed} · {userType === 'patient' ? followUps.filter((item) => item.status === 'pending').length : pendingFollowUps}</strong></div></section>
    <section className="grid gap-3 sm:grid-cols-[1fr_auto]"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search patient or therapy" className="rounded-lg border border-amber-200 bg-white px-3 py-2" /><select aria-label="Filter sessions" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-lg border border-amber-200 bg-white px-3 py-2">{['all', 'today', 'upcoming', 'scheduled', 'confirmed', 'in-progress', 'completed', 'cancelled'].map((value) => <option key={value} value={value}>{value.replace('-', ' ')}</option>)}</select></section>
    {loading ? <p role="status">Loading sessions…</p> : filtered.length === 0 ? <p className="rounded-xl bg-white p-6 text-center text-gray-600">No sessions match this view.</p> : <div className="grid gap-3 lg:grid-cols-2">{filtered.map((session) => <article key={session._id} className="rounded-xl border border-amber-200 bg-white p-4"><button onClick={() => setSelected(session)} className="w-full text-left"><div className="flex justify-between gap-3"><div><h2 className="font-semibold">{session.sessionName || session.therapyType}</h2><p className="text-sm text-gray-600">{session.patient?.name || 'Patient'}{session.patient?.email ? ` · ${session.patient.email}` : ''}</p></div><span className="h-fit rounded-full bg-amber-100 px-2 py-1 text-xs capitalize">{session.status}</span></div><p className="mt-2 flex items-center gap-2 text-sm"><CalendarDays className="h-4 w-4" />{new Date(session.date).toLocaleDateString()} · {session.startTime} · {session.durationMins || 60} min</p><p className="mt-1 text-sm">{session.therapySnapshot?.name || session.therapyType}</p></button><div className="mt-3 flex flex-wrap gap-2">{['practitioner', 'admin'].includes(userType) && (statusActions[session.status] || []).map((status) => <button key={status} disabled={saving} onClick={() => updateStatus(session, status)} className="rounded-md bg-amber-700 px-3 py-1.5 text-sm text-white disabled:opacity-50">{status === 'in-progress' ? 'Start session' : status[0].toUpperCase() + status.slice(1)}</button>)}<button onClick={() => setSelected(session)} className="rounded-md border border-amber-300 px-3 py-1.5 text-sm">Session detail</button></div></article>)}</div>}

    {selected && <section className="space-y-4 rounded-2xl border border-amber-200 bg-white p-5"><header className="flex justify-between gap-2"><div><h2 className="text-xl font-semibold">{selected.sessionName || selected.therapyType}</h2><p className="text-sm text-gray-600">{selected.patient?.name || 'Patient'} · {new Date(selected.date).toLocaleDateString()} · {selected.startTime} · {selected.status}</p></div><button onClick={() => setSelected(null)} className="h-fit rounded border px-3 py-1">Close</button></header>
      <div className="grid gap-4 md:grid-cols-2"><div className="rounded-lg bg-amber-50 p-4"><h3 className="font-semibold">Therapy information</h3><p className="mt-1 text-sm">{selected.therapySnapshot?.description || selected.therapyType}</p><p className="mt-2 text-sm"><b>Preparation:</b> {selected.therapySnapshot?.preparationInstructions || 'No preparation instructions recorded.'}</p><p className="mt-2 text-sm"><b>Aftercare:</b> {selected.therapySnapshot?.postTherapyInstructions || 'No aftercare instructions recorded.'}</p><p className="mt-2 text-sm"><b>Actual duration:</b> {selected.clinicalRecord?.actualDurationMins != null ? `${selected.clinicalRecord.actualDurationMins} minutes` : 'Not recorded'}</p><p className="mt-2 text-sm"><b>Practitioner:</b> {selected.practitioner?.name || 'Not assigned'}</p></div><div className="rounded-lg bg-stone-50 p-4"><h3 className="font-semibold">Session history</h3>{selected.statusHistory?.length ? selected.statusHistory.map((item, index) => <p key={`${item.status}-${index}`} className="mt-2 text-sm capitalize">{item.status} · {new Date(item.changedAt).toLocaleString()}</p>) : <p className="mt-2 text-sm text-gray-600">No status changes recorded.</p>}{selected.clinicalRecord?.actualStartedAt && <p className="mt-2 text-sm">Started: {new Date(selected.clinicalRecord.actualStartedAt).toLocaleString()}</p>}{selected.clinicalRecord?.actualCompletedAt && <p className="mt-2 text-sm">Completed: {new Date(selected.clinicalRecord.actualCompletedAt).toLocaleString()}</p>}</div></div>
      {['practitioner', 'admin'].includes(userType) && <form onSubmit={saveRecord} className="grid gap-3 md:grid-cols-2"><h3 className="font-semibold md:col-span-2"><ClipboardList className="mr-2 inline h-4 w-4" />Practitioner session record</h3>{[['observations','Observations'],['treatmentNotes','Treatment notes'],['completionRemarks','Completion remarks'],['followUpRecommendations','Follow-up recommendations']].map(([key,label]) => <label key={key} className="text-sm">{label}<textarea maxLength={key.includes('Remarks') || key.includes('Recommendations') ? 3000 : 5000} rows="3" value={record[key]} onChange={(event) => setRecord({ ...record, [key]: event.target.value })} className="mt-1 block w-full rounded border border-amber-200 p-2" /></label>)}<button disabled={saving} className="rounded-lg bg-amber-700 px-4 py-2 text-white md:col-span-2">Save session record</button></form>}
      {userType === 'patient' && selected.status === 'completed' && !selected.feedback?.submittedAt && <form onSubmit={submitFeedback} className="grid gap-3 rounded-lg bg-amber-50 p-4 sm:grid-cols-[auto_1fr_auto]"><label className="text-sm">Session rating<select value={feedback.rating} onChange={(event) => setFeedback({ ...feedback, rating: Number(event.target.value) })} className="mt-1 block rounded border p-2">{[1,2,3,4,5].map((rating) => <option key={rating}>{rating}</option>)}</select></label><label className="text-sm">Optional comments<textarea maxLength="2000" value={feedback.comments} onChange={(event) => setFeedback({ ...feedback, comments: event.target.value })} className="mt-1 block w-full rounded border p-2" /></label><button disabled={saving} className="self-end rounded-lg bg-amber-700 px-4 py-2 text-white">Submit feedback</button></form>}
      {userType === 'patient' && selected.feedback?.submittedAt && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800">Feedback submitted {new Date(selected.feedback.submittedAt).toLocaleDateString()}.</p>}
      {userType === 'patient' && selected.feedback?.submittedAt && <p className="text-sm text-gray-700">Your rating: {selected.feedback.wellness}/5{selected.feedback.comments ? ` · ${selected.feedback.comments}` : ''}</p>}
      {['practitioner', 'admin'].includes(userType) && <form onSubmit={createFollowUp} className="grid gap-3 rounded-lg border border-amber-200 p-4 md:grid-cols-[auto_1fr_auto]"><h3 className="font-semibold md:col-span-3">Schedule a patient follow-up</h3><label className="text-sm">Due date<input type="date" required min={dateInput(new Date())} value={followUpForm.dueAt} onChange={(event) => setFollowUpForm({ ...followUpForm, dueAt: event.target.value })} className="mt-1 block rounded border p-2" /></label><label className="text-sm">Follow-up notes<textarea required maxLength="3000" value={followUpForm.notes} onChange={(event) => setFollowUpForm({ ...followUpForm, notes: event.target.value })} className="mt-1 block w-full rounded border p-2" /></label><button disabled={saving} className="self-end rounded-lg border border-amber-400 px-4 py-2">Create follow-up</button></form>}
    </section>}

    {userType === 'patient' && <section className="space-y-2 rounded-xl border border-amber-200 bg-white p-4"><h2 className="text-lg font-semibold">My follow-ups</h2>{followUps.length === 0 ? <p className="text-sm text-gray-600">No follow-ups have been scheduled.</p> : followUps.map((item) => <article key={item._id} className="rounded-lg bg-amber-50 p-3"><p className="font-medium">{new Date(item.dueAt).toLocaleDateString()} · <span className="capitalize">{item.status}</span></p>{item.session && <p className="text-sm">Related session: {item.session.sessionName || item.session.therapyType}</p>}</article>)}</section>}
    {['practitioner', 'admin'].includes(userType) && <section className="space-y-2 rounded-xl border border-amber-200 bg-white p-4"><h2 className="text-lg font-semibold">Follow-up list</h2>{followUps.length === 0 ? <p className="text-sm text-gray-600">No follow-ups recorded.</p> : followUps.map((item) => <article key={item._id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 p-3"><div><p className="font-medium">{item.patient?.name || 'Patient'} · {new Date(item.dueAt).toLocaleDateString()}</p><p className="text-sm">{item.notes}</p><p className="text-xs capitalize">{item.status}{item.session ? ` · ${item.session.sessionName || item.session.therapyType}` : ''}</p></div>{item.status === 'pending' && <button onClick={() => completeFollowUp(item._id)} className="rounded border border-amber-400 px-3 py-1.5 text-sm">Mark complete</button>}</article>)}</section>}
  </main>;
}
