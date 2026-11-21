import React, { useEffect, useState } from 'react';
import { CheckCircle2, Circle, Clock3 } from 'lucide-react';
import authFetch from '../../utils/apiClient';

const isConsultationSession = (session) => !session.treatmentPlan && (['Clinic Appointment', 'General Slot', 'Consultation Slot'].includes(session.sessionName) || ['Custom', 'Consultation', 'General Consultation'].includes(session.therapyType));
const PatientTreatmentProgress = ({ user }) => {
  const [dashboard, setDashboard] = useState(null); const [plans, setPlans] = useState([]); const [sessions, setSessions] = useState([]); const [followUps, setFollowUps] = useState([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const responses = await Promise.all([authFetch('/api/dashboard/patient'), authFetch(`/api/treatment-plans/patients/${user?._id}`), authFetch('/sessions'), authFetch('/api/follow-ups')]);
        const bodies = await Promise.all(responses.map((response) => response.json()));
        const failed = responses.findIndex((response) => !response.ok);
        if (failed >= 0) throw new Error(bodies[failed].message || bodies[failed].msg || 'Unable to load treatment progress');
        if (active) { setDashboard(bodies[0]); setPlans(bodies[1].plans || []); setSessions((Array.isArray(bodies[2]) ? bodies[2] : bodies[2].sessions || []).filter((item) => !isConsultationSession(item))); setFollowUps(bodies[3].followUps || []); }
      } catch (e) { if (active) setError(e.message); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [user?._id]);
  const activePlan = plans.find((item) => item.status === 'approved') || plans.find((item) => ['pending-approval', 'draft'].includes(item.status));
  const counts = dashboard?.sessionCounts || { planned: 0, generated: sessions.length, completed: sessions.filter((session) => session.status === 'completed').length, upcoming: sessions.filter((session) => ['scheduled', 'confirmed'].includes(session.status)).length, cancelled: sessions.filter((session) => session.status === 'cancelled').length, remainingToGenerate: 0 };
  const percent = counts.generated ? Math.round((counts.completed / counts.generated) * 100) : null;
  const timeline = [...sessions].sort((a, b) => new Date(a.date) - new Date(b.date));
  return <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 text-amber-950 sm:px-6">
    <header><h1 className="text-2xl font-semibold">Treatment Progress</h1><p className="mt-1 text-sm text-amber-800">A record of planned and completed sessions. This tracker is not a prediction of clinical outcome.</p></header>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}{loading && <p role="status">Loading treatment progress…</p>}
    {!loading && <>
      {activePlan ? <section className="rounded-xl border border-amber-200 bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Current treatment plan</h2><p className="mt-1 text-sm capitalize">Status: {activePlan.status.replace('-', ' ')}</p><p className="text-sm text-stone-600">Vaidya: {activePlan.doctor?.name || dashboard?.assignedPractitioner?.name || 'Assigned practitioner'} · Start: {new Date(activePlan.startDate).toLocaleDateString()}</p></div>{percent === null ? <span className="rounded-full bg-amber-100 px-3 py-1 text-sm">Not started</span> : <strong className="text-xl text-amber-800">{percent}%</strong>}</div>
        {percent !== null && <div className="mt-4 h-2 overflow-hidden rounded-full bg-amber-100"><div className="h-full bg-amber-600" style={{ width: `${percent}%` }} /></div>}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">{[['Planned', counts.planned], ['Generated', counts.generated], ['Completed', counts.completed], ['Upcoming', counts.upcoming], ['Cancelled', counts.cancelled], ['Not yet generated', counts.remainingToGenerate]].map(([label, value]) => <div key={label} className="rounded-lg bg-amber-50 p-3"><p className="text-xs text-stone-600">{label}</p><strong className="text-xl">{value}</strong></div>)}</div>
      </section> : <section className="rounded-xl border border-amber-200 bg-amber-50 p-5"><h2 className="font-semibold">No active approved treatment plan</h2><p className="mt-1 text-sm">{plans[0]?.status === 'pending-approval' ? 'Your treatment plan is pending approval.' : plans[0]?.status === 'rejected' ? 'Your latest plan was declined. Contact your Vaidya for next steps.' : 'Your Vaidya will prepare and approve a plan after your assessment.'}</p></section>}
      <section className="rounded-xl border border-amber-200 bg-white p-5"><h2 className="font-semibold">Therapy-wise plan</h2>{activePlan?.therapies?.length ? <div className="mt-3 divide-y divide-amber-100">{activePlan.therapies.map((therapy, index) => { const matched = sessions.filter((session) => session.therapyType === therapy.therapyType && session.sessionName === therapy.sessionName); return <article key={`${therapy.sessionName}-${index}`} className="py-3"><div className="flex justify-between gap-3"><div><p className="font-medium">{therapy.sessionName || therapy.therapyType}</p><p className="text-sm text-stone-600">{therapy.phase} · {matched.filter((item) => item.status === 'completed').length} of {matched.length} generated completed · {therapy.occurrences} planned</p></div><span className="text-sm">{therapy.durationMins} min</span></div>{therapy.instructions && <p className="mt-1 text-sm">{therapy.instructions}</p>}</article>; })}</div> : <p className="mt-2 text-sm text-stone-600">Therapy details will appear when your Vaidya submits a plan.</p>}</section>
      <section className="rounded-xl border border-amber-200 bg-white p-5"><h2 className="font-semibold">Session history</h2>{timeline.length ? <ol className="mt-3 space-y-3">{timeline.map((session) => <li key={session._id} className="flex gap-3"><span className="mt-0.5">{session.status === 'completed' ? <CheckCircle2 className="h-5 w-5 text-green-700" /> : session.status === 'cancelled' ? <Circle className="h-5 w-5 text-stone-400" /> : <Clock3 className="h-5 w-5 text-amber-700" />}</span><div><p className="font-medium">{session.therapySnapshot?.name || session.sessionName || session.therapyType} <span className="font-normal capitalize text-stone-600">· {session.status}</span></p><p className="text-sm text-stone-600">{new Date(session.date).toLocaleDateString()} · {session.startTime} · {session.durationMins || 60} minutes · {session.practitioner?.name || 'Vaidya'}</p></div></li>)}</ol> : <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm">No generated therapy session history yet. Planned sessions are not counted as generated until your Vaidya creates the schedule.</p>}</section>
      <section className="rounded-xl border border-amber-200 bg-white p-5"><h2 className="font-semibold">Follow-up history</h2>{followUps.length ? <div className="mt-3 space-y-2">{followUps.map((item) => <article key={item._id} className="rounded-lg bg-amber-50 p-3"><p className="font-medium">{new Date(item.dueAt).toLocaleDateString()} · <span className="capitalize">{item.status}</span></p><p className="text-sm text-stone-700">{item.notes}</p><p className="text-xs text-stone-600">{item.practitioner?.name || 'Assigned practitioner'}</p></article>)}</div> : <p className="mt-2 text-sm text-stone-600">No follow-ups have been recorded.</p>}</section>
    </>}
  </main>;
};
export default PatientTreatmentProgress;
