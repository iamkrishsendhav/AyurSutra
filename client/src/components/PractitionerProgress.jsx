import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Calendar, CheckCircle2, Clock, User } from 'lucide-react';
import authFetch from '../utils/apiClient';

const PractitionerProgress = ({ user, onSelectPatient }) => {
  const [patients, setPatients] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [patientResponse, sessionResponse] = await Promise.all([authFetch('/api/practitioner/patients'), authFetch('/sessions')]);
      const [patientData, sessionData] = await Promise.all([patientResponse.json(), sessionResponse.json()]);
      if (!patientResponse.ok) throw new Error(patientData.message || 'Unable to load assigned patients');
      if (!sessionResponse.ok) throw new Error(sessionData.message || 'Unable to load therapy sessions');
      const patientRows = Array.isArray(patientData.patients) ? patientData.patients : [];
      setPatients(patientRows); setSessions(Array.isArray(sessionData) ? sessionData : []);
      setSelectedId((current) => patientRows.some((item) => item._id === current) ? current : patientRows[0]?._id || '');
    } catch (e) { setError(e.message || 'Unable to load treatment progress'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const selected = patients.find((item) => item._id === selectedId);
  const patientSessions = useMemo(() => sessions.filter((item) => String(item.patient?._id || item.patient) === String(selectedId)).sort((a, b) => new Date(a.date) - new Date(b.date) || String(a.startTime).localeCompare(String(b.startTime))), [sessions, selectedId]);
  const generated = patientSessions.filter((item) => item.treatmentPlan);
  const completed = generated.filter((item) => item.status === 'completed').length;
  const cancelled = generated.filter((item) => item.status === 'cancelled').length;
  const progress = generated.length ? Math.round(completed / generated.length * 100) : null;
  const byTherapy = generated.reduce((map, item) => { const name = item.sessionName || item.therapyType || 'Therapy'; if (!map[name]) map[name] = { total: 0, completed: 0 }; map[name].total += 1; if (item.status === 'completed') map[name].completed += 1; return map; }, {});

  if (loading) return <p role="status" className="p-6 text-amber-900">Loading treatment progress…</p>;
  return <main className="mx-auto max-w-6xl space-y-5 p-4 text-amber-950 sm:p-6">
    <header><h1 className="text-2xl font-semibold">Treatment Progress</h1><p className="mt-1 text-sm text-amber-800">Progress is calculated from generated treatment sessions and their recorded status.</p></header>
    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">{error}<button type="button" onClick={load} className="ml-3 underline">Retry</button></div>}
    {!error && !patients.length && <p className="rounded-xl border border-amber-200 bg-white p-5">No assigned patients to track yet.</p>}
    {patients.length > 0 && <div className="grid gap-5 lg:grid-cols-[minmax(15rem,0.8fr)_2fr]">
      <section className="space-y-2 rounded-xl border border-amber-200 bg-white p-4"><h2 className="mb-2 font-semibold">Assigned patients</h2>{patients.map((patient) => <button type="button" key={patient._id} onClick={() => setSelectedId(patient._id)} className={`w-full rounded-lg border p-3 text-left ${selectedId === patient._id ? 'border-amber-500 bg-amber-50' : 'border-amber-100 hover:bg-amber-50'}`}><span className="flex items-center gap-2 font-medium"><User className="h-4 w-4"/>{patient.name}</span><span className="mt-1 block text-xs text-stone-600">{patient.treatmentStatus || 'No plan'}</span></button>)}</section>
      {selected && <section className="space-y-4 rounded-xl border border-amber-200 bg-white p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="text-xl font-semibold">{selected.name}</h2><p className="text-sm text-stone-600">{selected.activePlan?.title || selected.activePlan?.status || selected.treatmentStatus}</p></div><button type="button" onClick={() => onSelectPatient?.(selected._id)} className="rounded-lg border border-amber-300 px-3 py-2 text-sm">Open clinical workspace</button></div>
        <div className="grid gap-3 sm:grid-cols-4"><Metric icon={Activity} label="Generated sessions" value={generated.length}/><Metric icon={CheckCircle2} label="Completed" value={completed}/><Metric icon={Clock} label="Cancelled" value={cancelled}/><Metric icon={Calendar} label="Progress" value={progress === null ? 'Not started' : `${progress}%`}/></div>
        {generated.length > 0 && <div><div className="mb-1 flex justify-between text-xs"><span>Completed treatment sessions</span><span>{progress}%</span></div><div className="h-2 overflow-hidden rounded-full bg-amber-100"><div className="h-full rounded-full bg-amber-600" style={{ width: `${progress}%` }}/></div></div>}
        <div><h3 className="font-semibold">Therapy-wise progress</h3>{Object.keys(byTherapy).length ? <div className="mt-2 grid gap-2 sm:grid-cols-2">{Object.entries(byTherapy).map(([name, counts]) => <p key={name} className="rounded-lg bg-amber-50 p-3 text-sm">{name}<span className="float-right font-medium">{counts.completed}/{counts.total}</span></p>)}</div> : <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm">No generated therapy sessions. Progress will appear after an approved plan is generated.</p>}</div>
        <div><h3 className="font-semibold">Session history</h3>{patientSessions.length ? <ol className="mt-2 space-y-2">{patientSessions.map((item) => <li key={item._id} className="flex flex-wrap justify-between gap-2 rounded-lg border border-amber-100 p-3 text-sm"><span>{item.sessionName || item.therapyType} · {item.treatmentPlan ? 'Treatment session' : 'Consultation'}</span><span className="text-stone-600">{new Date(item.date).toLocaleDateString()} · {item.startTime || ''} · <span className="capitalize">{item.status}</span></span></li>)}</ol> : <p className="mt-2 text-sm text-stone-600">No therapy or consultation history.</p>}</div>
      </section>}
    </div>}
  </main>;
};

function Metric({ icon: Icon, label, value }) { return <div className="rounded-lg bg-amber-50 p-3"><div className="flex items-center gap-2 text-xs text-stone-600"><Icon className="h-4 w-4"/>{label}</div><strong className="mt-1 block text-xl">{value}</strong></div>; }
export default PractitionerProgress;
