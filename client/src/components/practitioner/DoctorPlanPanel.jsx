import React, { useCallback, useEffect, useState } from 'react';
import authFetch from '../../utils/apiClient';

const emptyTherapy = () => ({ catalogTherapyId: '', therapyType: '', sessionName: '', phase: 'Pre', durationMins: 60, frequencyDays: 1, occurrences: 1, startTime: '10:00', instructions: '' });

export default function DoctorPlanPanel({ patientId, readOnly = false }) {
  const [assessments, setAssessments] = useState([]);
  const [plans, setPlans] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [catalogue, setCatalogue] = useState([]);
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({ symptoms: '', observations: '', diagnosis: '', recommendations: '', clinicalNotes: '' });
  const [therapies, setTherapies] = useState([emptyTherapy()]);
  const [planInfo, setPlanInfo] = useState({ title: '', objectives: '', precautions: '' });
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    try {
      const [a, p, s, catalogueResponse] = await Promise.all([
        authFetch(`/api/treatment-plans/patients/${patientId}/assessments`),
        authFetch(`/api/treatment-plans/patients/${patientId}`),
        ...(readOnly ? [authFetch('/sessions')] : [Promise.resolve(null)]),
        ...(readOnly ? [Promise.resolve(null)] : [authFetch('/api/therapies')]),
      ]);
      if (!a.ok || !p.ok || (s && !s.ok) || (catalogueResponse && !catalogueResponse.ok)) throw new Error('Unable to load clinical records');
      const [assessmentsResponse, plansResponse, sessionResponse, catalogueData] = await Promise.all([
        a.json(), p.json(), s ? s.json() : Promise.resolve([]), catalogueResponse ? catalogueResponse.json() : Promise.resolve({ therapies: [] }),
      ]);
      setAssessments(assessmentsResponse.assessments || []);
      setPlans(plansResponse.plans || []);
      setSessions(Array.isArray(sessionResponse) ? sessionResponse : []);
      setCatalogue(Array.isArray(catalogueData.therapies) ? catalogueData.therapies : []);
      setStatus('loaded');
    } catch (error) { setMessage(error.message); setStatus('error'); }
  }, [patientId, readOnly]);

  useEffect(() => { load(); }, [load]);

  const submitAssessment = async (event) => {
    event.preventDefault(); setMessage('');
    try {
      const response = await authFetch(`/api/treatment-plans/patients/${patientId}/assessments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, symptoms: form.symptoms.split(',').map((item) => item.trim()).filter(Boolean) }),
      });
      if (!response.ok) throw new Error((await response.json()).message || 'Assessment could not be saved');
      setForm({ symptoms: '', observations: '', diagnosis: '', recommendations: '', clinicalNotes: '' });
      setMessage('Assessment saved.'); await load();
    } catch (error) { setMessage(error.message); }
  };

  const createPlan = async (event) => {
    event.preventDefault(); setMessage('');
    try {
      const response = await authFetch(`/api/treatment-plans/patients/${patientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessmentId: assessments[0]?._id, startDate, ...planInfo, therapies, submitForApproval: true }),
      });
      if (!response.ok) throw new Error((await response.json()).message || 'Plan could not be saved');
      setMessage('Treatment plan submitted for approval.'); setTherapies([emptyTherapy()]); setPlanInfo({ title: '', objectives: '', precautions: '' }); await load();
    } catch (error) { setMessage(error.message); }
  };

  const reviewPlan = async (planId, decision) => {
    try {
      const response = await authFetch(`/api/treatment-plans/${planId}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }) });
      if (!response.ok) throw new Error((await response.json()).message || 'Review failed');
      setMessage(`Plan ${decision}.`); await load();
    } catch (error) { setMessage(error.message); }
  };

  const generate = async (planId) => {
    try {
      const response = await authFetch(`/api/treatment-plans/${planId}/generate-sessions`, { method: 'POST' });
      if (!response.ok) throw new Error((await response.json()).message || 'Session generation failed');
      const result = await response.json(); setMessage(`${result.createdCount} sessions generated.`); await load();
    } catch (error) { setMessage(error.message); }
  };

  if (status === 'loading') return <p role="status" className="text-amber-800">Loading assessments and plans…</p>;
  if (status === 'error') return <section className="mt-8 space-y-4 rounded-xl border border-amber-100 bg-[#FDF7E9] p-5 text-amber-900">
    <h2 className="text-xl font-semibold">Clinical Assessment &amp; Treatment Plans</h2>
    <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-red-800">{message || 'Unable to load clinical records.'}</div>
    <button type="button" onClick={load} className="rounded bg-amber-700 px-4 py-2 text-white">Try again</button>
  </section>;
  return <section className="mt-8 space-y-6 rounded-xl border border-amber-100 bg-[#FDF7E9] p-5 text-amber-900">
    <h2 className="text-xl font-semibold">Clinical Assessment &amp; Treatment Plans</h2>
    {message && <p role="status" className="text-sm">{message}</p>}
    {status === 'error' && <p role="alert">{message}</p>}
    {!readOnly && <form onSubmit={submitAssessment} className="grid grid-cols-1 gap-3">
      <h3 className="font-medium">New doctor assessment</h3>
      <input aria-label="Symptoms, comma separated" placeholder="Symptoms (comma separated)" value={form.symptoms} onChange={(e) => setForm({ ...form, symptoms: e.target.value })} className="rounded border border-amber-200 p-2" />
      {['observations', 'diagnosis', 'recommendations', 'clinicalNotes'].map((key) => <textarea key={key} aria-label={key} placeholder={key[0].toUpperCase() + key.slice(1)} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} className="rounded border border-amber-200 p-2" />)}
      <button className="w-fit rounded bg-amber-700 px-4 py-2 text-white">Save assessment</button>
    </form>}
    <div><h3 className="font-medium">Assessment history</h3>{assessments.length ? assessments.map((item) => <article key={item._id} className="mt-2 rounded border border-amber-100 bg-white/70 p-3"><p className="text-xs text-stone-600">{new Date(item.assessedAt).toLocaleDateString()}</p>{item.symptoms?.length > 0 && <p className="mt-1 text-sm"><strong>Symptoms:</strong> {item.symptoms.join(', ')}</p>}{item.diagnosis && <p className="mt-1 text-sm"><strong>Assessment:</strong> {item.diagnosis}</p>}{item.observations && <p className="mt-1 whitespace-pre-wrap text-sm"><strong>Observations:</strong> {item.observations}</p>}{item.recommendations && <p className="mt-1 whitespace-pre-wrap text-sm"><strong>Recommendations:</strong> {item.recommendations}</p>}{item.clinicalNotes && <p className="mt-1 whitespace-pre-wrap text-sm"><strong>Clinician-only notes:</strong> {item.clinicalNotes}</p>}</article>) : <p className="mt-2 text-sm">No assessments recorded.</p>}</div>
    {!readOnly && assessments.length > 0 && <form onSubmit={createPlan} className="grid grid-cols-1 gap-3 border-t border-amber-200 pt-4">
      <h3 className="font-medium">Create treatment plan from latest assessment</h3>
      {!catalogue.length && <p className="rounded bg-amber-100 p-3 text-sm">There are no active therapies in the catalogue. Ask an administrator to add therapies before creating a plan.</p>}
      <input required maxLength={160} placeholder="Treatment plan title" value={planInfo.title} onChange={(event) => setPlanInfo({ ...planInfo, title: event.target.value })} className="rounded border border-amber-200 p-2" />
      <textarea maxLength={3000} placeholder="Treatment objectives (optional)" value={planInfo.objectives} onChange={(event) => setPlanInfo({ ...planInfo, objectives: event.target.value })} className="rounded border border-amber-200 p-2" />
      <textarea maxLength={3000} placeholder="Plan precautions (optional)" value={planInfo.precautions} onChange={(event) => setPlanInfo({ ...planInfo, precautions: event.target.value })} className="rounded border border-amber-200 p-2" />
      <label>Plan start date<input required type="date" min={new Date().toISOString().slice(0, 10)} value={startDate} onChange={(e) => setStartDate(e.target.value)} className="block w-full rounded border border-amber-200 p-2" /></label>
      {therapies.map((therapy, index) => <fieldset key={index} className="grid grid-cols-1 gap-3 rounded-lg border border-amber-200 bg-white/60 p-3"><legend className="px-1 text-sm font-semibold">Therapy {index + 1}</legend>
        <label className="text-sm font-medium">Active therapy catalogue<select required value={therapy.catalogTherapyId} onChange={(event) => { const selected = catalogue.find((item) => item._id === event.target.value); setTherapies((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, catalogTherapyId: selected?._id || '', therapyType: selected?.name || '', sessionName: selected?.name || '', durationMins: selected?.durationMins || 60, instructions: selected?.preparationInstructions || '' } : item)); }} className="mt-1 block w-full rounded border border-amber-200 p-2"><option value="">Select a catalogue therapy</option>{catalogue.map((item) => <option key={item._id} value={item._id}>{item.name} · {item.category} · {item.durationMins} min</option>)}</select></label>
        {therapy.catalogTherapyId && (() => { const selected = catalogue.find((item) => item._id === therapy.catalogTherapyId); return selected && <div className="rounded bg-amber-50 p-3 text-sm"><p>{selected.description}</p>{selected.requiredSkills?.length > 0 && <p className="mt-1"><strong>Required skills:</strong> {selected.requiredSkills.join(', ')}</p>}{selected.preparationInstructions && <p className="mt-1"><strong>Preparation:</strong> {selected.preparationInstructions}</p>}{selected.postTherapyInstructions && <p className="mt-1"><strong>Aftercare:</strong> {selected.postTherapyInstructions}</p>}{selected.contraindications && <p className="mt-1"><strong>Catalogue precautions:</strong> {selected.contraindications}</p>}</div>; })()}
        <input required maxLength={160} placeholder="Session name" value={therapy.sessionName} onChange={(event) => setTherapies((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, sessionName: event.target.value } : item))} className="rounded border border-amber-200 p-2" />
        <div className="grid grid-cols-2 gap-3"><label>Phase<select value={therapy.phase} onChange={(event) => setTherapies((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, phase: event.target.value } : item))} className="block w-full rounded border border-amber-200 p-2"><option>Pre</option><option>Main</option><option>Post</option></select></label><label>Start time<input type="time" value={therapy.startTime} onChange={(event) => setTherapies((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, startTime: event.target.value } : item))} className="block w-full rounded border border-amber-200 p-2" /></label></div>
        <div className="grid grid-cols-2 gap-3"><label>Duration minutes<input type="number" min="1" max="480" value={therapy.durationMins} readOnly className="block w-full rounded border border-amber-200 bg-amber-50 p-2" /></label><label>Repeat every days<input type="number" min="1" max="365" value={therapy.frequencyDays} onChange={(event) => setTherapies((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, frequencyDays: Number(event.target.value) } : item))} className="block w-full rounded border border-amber-200 p-2" /></label></div>
        <label>Occurrences<input type="number" min="1" max="100" value={therapy.occurrences} onChange={(event) => setTherapies((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, occurrences: Number(event.target.value) } : item))} className="block w-full rounded border border-amber-200 p-2" /></label>
        <textarea maxLength={3000} placeholder="Therapy-specific instructions" value={therapy.instructions} onChange={(event) => setTherapies((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, instructions: event.target.value } : item))} className="rounded border border-amber-200 p-2" />
        {therapies.length > 1 && <button type="button" onClick={() => setTherapies((items) => items.filter((_, itemIndex) => itemIndex !== index))} className="w-fit text-sm text-red-700 underline">Remove therapy</button>}
      </fieldset>)}
      <button type="button" disabled={!catalogue.length} onClick={() => setTherapies((items) => [...items, emptyTherapy()])} className="w-fit rounded border border-amber-400 px-3 py-2 text-sm disabled:opacity-50">Add another therapy</button>
      <button disabled={!therapies.length || therapies.some((item) => !item.catalogTherapyId) || !catalogue.length} className="w-fit rounded bg-amber-700 px-4 py-2 text-white disabled:opacity-50">Submit plan for approval</button>
    </form>}
    <div className="space-y-3"><h3 className="font-medium">Treatment plans</h3>{plans.length ? plans.map((plan) => <div key={plan._id} className="rounded border border-amber-200 bg-white/70 p-3"><p className="font-medium">{plan.title || 'Treatment plan'} · <span className="capitalize">{plan.status}</span></p><p className="mt-1 text-sm">{plan.therapies.map((item) => item.therapyType).join(', ')} · created {new Date(plan.createdAt).toLocaleDateString()}</p>{plan.objectives && <p className="mt-2 text-sm"><strong>Objectives:</strong> {plan.objectives}</p>}{plan.precautions && <p className="mt-1 text-sm"><strong>Precautions:</strong> {plan.precautions}</p>}{plan.approval?.reviewedAt && <p className="mt-1 text-xs text-stone-600">{plan.approval.status} on {new Date(plan.approval.reviewedAt).toLocaleDateString()}{plan.approval.note ? ` · ${plan.approval.note}` : ''}</p>}{plan.therapies.map((item, index) => <p key={index} className="mt-1 text-sm">{item.sessionName}: {item.durationMins} min, every {item.frequencyDays} day(s), {item.occurrences} occurrence(s). {item.instructions}</p>)}{!readOnly && plan.status === 'pending-approval' && <div className="mt-2 flex gap-2"><button type="button" onClick={() => reviewPlan(plan._id, 'approved')} className="rounded bg-amber-700 px-3 py-1 text-white">Approve</button><button type="button" onClick={() => reviewPlan(plan._id, 'rejected')} className="rounded border border-amber-400 px-3 py-1">Reject</button></div>}{!readOnly && plan.status === 'approved' && !plan.generatedAt && <button type="button" onClick={() => generate(plan._id)} className="mt-2 rounded bg-amber-700 px-3 py-1 text-white">Generate sessions</button>}</div>) : <p className="text-sm">No treatment plans yet.</p>}</div>
    {readOnly && <div className="space-y-3 border-t border-amber-200 pt-4">
      <h3 className="font-medium">Your therapy sessions</h3>
      {(() => {
        const approvedPlans = plans.filter((plan) => plan.status === 'approved');
        const plannedCount = approvedPlans.reduce((total, plan) => total + plan.therapies.reduce((sum, item) => sum + Number(item.occurrences || 0), 0), 0);
        const generatedPlanIds = new Set(approvedPlans.filter((plan) => plan.generatedAt).map((plan) => String(plan._id)));
        const completedCount = sessions.filter((session) => session.status === 'completed' && generatedPlanIds.has(String(session.treatmentPlan?._id || session.treatmentPlan || ''))).length;
        const upcomingCount = sessions.filter((session) => ['scheduled', 'confirmed'].includes(session.status) && new Date(session.date) >= new Date(new Date().setHours(0, 0, 0, 0))).length;
        const remainingCount = Math.max(0, plannedCount - completedCount);
        const timeline = [...sessions].sort((a, b) => new Date(a.date) - new Date(b.date));
        return <>
          <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-lg bg-white p-3"><p className="text-xs text-gray-600">Planned sessions</p><strong>{plannedCount}</strong></div><div className="rounded-lg bg-white p-3"><p className="text-xs text-gray-600">Completed from approved plans</p><strong>{completedCount}</strong></div><div className="rounded-lg bg-white p-3"><p className="text-xs text-gray-600">Remaining · upcoming</p><strong>{remainingCount} · {upcomingCount}</strong></div></div>
          <div className="rounded-lg border border-amber-100 bg-white/70 p-3"><h4 className="text-sm font-semibold">Treatment timeline</h4>{timeline.length ? timeline.map((item) => <p key={item._id} className="mt-1 text-sm">{new Date(item.date).toLocaleDateString()} · {item.sessionName || item.therapyType} · <span className="capitalize">{item.status}</span></p>) : <p className="mt-1 text-sm text-gray-600">No session timeline recorded.</p>}</div>
        </>;
      })()}
      {sessions.length ? sessions.map((session) => <article key={session._id} className="rounded border border-amber-200 bg-white/70 p-3">
        <p className="font-medium">{session.sessionName || session.therapyType} <span className="font-normal capitalize">· {session.status}</span></p>
        <p className="mt-1 text-sm">{new Date(session.date).toLocaleDateString()} at {session.startTime} · {session.durationMins || 60} minutes</p>
        {session.therapyType && <p className="text-sm">{session.therapyType}{session.phase ? ` · ${session.phase}` : ''}</p>}
      </article>) : <p className="text-sm">No therapy sessions scheduled yet.</p>}
    </div>}
  </section>;
}
