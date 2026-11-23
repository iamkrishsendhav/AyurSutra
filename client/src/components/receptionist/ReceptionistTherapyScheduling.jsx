import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, Clock3, UserRound } from 'lucide-react';
import authFetch from '../../utils/apiClient';

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export default function ReceptionistTherapyScheduling({ onScheduled, refreshKey = 0 }) {
  const [patientQuery, setPatientQuery] = useState('');
  const [patients, setPatients] = useState([]);
  const [patientId, setPatientId] = useState('');
  const [plans, setPlans] = useState([]);
  const [planId, setPlanId] = useState('');
  const [therapyId, setTherapyId] = useState('');
  const [occurrence, setOccurrence] = useState('');
  const [date, setDate] = useState(today());
  const [practitioners, setPractitioners] = useState([]);
  const [practitionerId, setPractitionerId] = useState('');
  const [slotId, setSlotId] = useState('');
  const [loadingPatients, setLoadingPatients] = useState(false);
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setLoadingPatients(true);
      try {
        const response = await authFetch(`/api/receptionist/patients?q=${encodeURIComponent(patientQuery)}`);
        const body = await response.json();
        if (!response.ok) throw new Error(body.message || 'Patient search failed');
        if (active) setPatients(body.patients || []);
      } catch (requestError) { if (active) setError(requestError.message); }
      finally { if (active) setLoadingPatients(false); }
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [patientQuery]);

  useEffect(() => {
    let active = true;
    setPlans([]); setPlanId(''); setTherapyId(''); setOccurrence(''); setPractitioners([]); setPractitionerId(''); setSlotId('');
    if (!patientId) return () => { active = false; };
    setLoadingPlans(true); setError('');
    authFetch(`/api/receptionist/patients/${patientId}/approved-treatment-plans`).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Approved treatment plans could not be loaded');
      if (active) setPlans(body.plans || []);
    }).catch((requestError) => { if (active) setError(requestError.message); })
      .finally(() => { if (active) setLoadingPlans(false); });
    return () => { active = false; };
  }, [patientId, refreshKey]);

  useEffect(() => {
    let active = true;
    setPractitioners([]); setPractitionerId(''); setSlotId('');
    if (!patientId || !planId || !therapyId || occurrence === '' || !date) return () => { active = false; };
    setLoadingAvailability(true); setError('');
    const query = new URLSearchParams({ patientId, planId, therapyId, occurrence, date });
    authFetch(`/api/receptionist/therapy-availability?${query}`).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Therapy availability could not be loaded');
      if (active) setPractitioners(body.practitioners || []);
    }).catch((requestError) => { if (active) setError(requestError.message); })
      .finally(() => { if (active) setLoadingAvailability(false); });
    return () => { active = false; };
  }, [patientId, planId, therapyId, occurrence, date]);

  const patient = useMemo(() => patients.find((item) => item._id === patientId), [patients, patientId]);
  const plan = useMemo(() => plans.find((item) => item._id === planId), [plans, planId]);
  const therapy = useMemo(() => plan?.therapies?.find((item) => item._id === therapyId), [plan, therapyId]);
  const practitioner = useMemo(() => practitioners.find((item) => item._id === practitionerId), [practitioners, practitionerId]);
  const slot = useMemo(() => practitioner?.slots?.find((item) => item._id === slotId), [practitioner, slotId]);
  const availableOccurrences = useMemo(() => therapy ? Array.from({ length: therapy.occurrences || 1 }, (_, index) => index).filter((index) => !(therapy.scheduledOccurrences || []).includes(index)) : [], [therapy]);

  const scheduleSession = async (event) => {
    event.preventDefault();
    if (!patientId || !planId || !therapyId || occurrence === '' || !practitionerId || !slotId) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await authFetch('/api/receptionist/therapy-sessions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientId, planId, therapyId, occurrence: Number(occurrence), slotId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Therapy session could not be scheduled');
      setNotice(`${therapy?.catalogSnapshot?.name || therapy?.therapyType} scheduled with ${practitioner?.name}.`);
      setSlotId('');
      setPlans((items) => items.map((item) => item._id !== planId ? item : { ...item, therapies: item.therapies.map((entry) => entry._id !== therapyId ? entry : { ...entry, scheduledOccurrences: [...new Set([...(entry.scheduledOccurrences || []), Number(occurrence)])] }) }));
      setOccurrence('');
      setPractitioners((items) => items.map((item) => item._id === practitionerId ? { ...item, slots: item.slots.filter((entry) => entry._id !== slotId) } : item));
      onScheduled?.(body.session);
    } catch (requestError) { setError(requestError.message); }
    finally { setSaving(false); }
  };

  const inputClass = 'mt-1 block w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm';
  return <section id="receptionist-therapy-scheduling" className="as-card space-y-4 p-5">
    <header><p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-700">Approved care plan</p><h2 className="mt-1 text-lg font-semibold">Therapy Scheduling &amp; Vaidya Assignment</h2><p className="mt-1 text-sm text-amber-800">Choose a patient's approved therapy, then assign an eligible Vaidya to a published available slot.</p></header>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
    <form onSubmit={scheduleSession} className="grid gap-3 md:grid-cols-2">
      <label className="text-sm font-medium">Search patient<input value={patientQuery} onChange={(event) => setPatientQuery(event.target.value)} placeholder="Name, email or phone" className={inputClass} /></label>
      <label className="text-sm font-medium">Select patient<select required value={patientId} onChange={(event) => setPatientId(event.target.value)} className={inputClass}><option value="">Choose a registered patient</option>{patients.map((item) => <option key={item._id} value={item._id}>{item.name} · {item.email}</option>)}</select>{loadingPatients && <span className="text-xs text-amber-700">Searching patients…</span>}</label>
      <label className="text-sm font-medium">Approved treatment plan<select required disabled={!patientId || loadingPlans} value={planId} onChange={(event) => { setPlanId(event.target.value); setTherapyId(''); }} className={inputClass}><option value="">{loadingPlans ? 'Loading plans…' : 'Choose an approved plan'}</option>{plans.map((item) => <option key={item._id} value={item._id}>{item.title || 'Approved treatment plan'} · starts {new Date(item.startDate).toLocaleDateString()}</option>)}</select>{patientId && !loadingPlans && plans.length === 0 && <span className="text-xs text-amber-800">No approved treatment plan is available for this patient.</span>}</label>
      <label className="text-sm font-medium">Prescribed therapy<select required disabled={!planId} value={therapyId} onChange={(event) => { setTherapyId(event.target.value); setOccurrence(''); }} className={inputClass}><option value="">Choose a therapy from the plan</option>{(plan?.therapies || []).map((item) => <option key={item._id} value={item._id}>{item.catalogSnapshot?.name || item.therapyType} · {item.phase} · {item.catalogSnapshot?.durationMins || item.durationMins} min</option>)}</select></label>
      {therapy && <label className="text-sm font-medium">Plan occurrence<select required value={occurrence} onChange={(event) => setOccurrence(event.target.value)} className={inputClass}><option value="">Choose an unscheduled occurrence</option>{availableOccurrences.map((index) => <option key={index} value={index}>Session {index + 1} of {therapy.occurrences}</option>)}</select>{availableOccurrences.length === 0 && <span className="text-xs text-amber-800">All prescribed occurrences for this therapy are already scheduled.</span>}</label>}
      <label className="text-sm font-medium">Appointment date<input required type="date" min={today()} value={date} onChange={(event) => { setDate(event.target.value); setSlotId(''); }} className={inputClass} /></label>
      <label className="text-sm font-medium">Available Vaidya<select required disabled={!therapyId || loadingAvailability} value={practitionerId} onChange={(event) => { setPractitionerId(event.target.value); setSlotId(''); }} className={inputClass}><option value="">{loadingAvailability ? 'Checking availability…' : 'Choose a Vaidya'}</option>{practitioners.map((item) => <option key={item._id} value={item._id}>{item.name}{item.practiceAreas?.length ? ` · ${item.practiceAreas.join(', ')}` : ''}</option>)}</select>{therapyId && !loadingAvailability && practitioners.length === 0 && <span className="text-xs text-amber-800">No verified Vaidya has a compatible open slot for this therapy and date.</span>}</label>
      <label className="text-sm font-medium md:col-span-2">Available start time<select required disabled={!practitionerId} value={slotId} onChange={(event) => setSlotId(event.target.value)} className={inputClass}><option value="">Choose a published slot</option>{(practitioner?.slots || []).map((item) => <option key={item._id} value={item._id}>{item.startTime} · {item.durationMins} minute slot</option>)}</select></label>
      {patient && plan && therapy && practitioner && slot && <aside className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 md:col-span-2"><h3 className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-4 w-4 text-amber-700"/>Scheduling summary</h3><div className="mt-2 grid gap-2 text-sm sm:grid-cols-2"><p className="flex items-center gap-2"><UserRound className="h-4 w-4"/>{patient.name} · {plan.title || 'Approved plan'}</p><p>{therapy.catalogSnapshot?.name || therapy.therapyType} · {therapy.phase} · occurrence {Number(occurrence) + 1} of {therapy.occurrences}</p><p>Assigned Vaidya: {practitioner.name}</p><p className="flex items-center gap-2"><CalendarDays className="h-4 w-4"/>{new Date(`${date}T00:00:00`).toLocaleDateString()} · {slot.startTime} · {therapy.catalogSnapshot?.durationMins || therapy.durationMins} min</p><p className="sm:col-span-2"><b>Instructions:</b> {therapy.instructions || therapy.catalogSnapshot?.preparationInstructions || 'Follow the approved treatment plan and therapy instructions.'}</p></div></aside>}
      <button disabled={saving || !slot} className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-700 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 md:col-span-2"><Clock3 className="h-4 w-4"/>{saving ? 'Scheduling…' : 'Confirm therapy session'}</button>
    </form>
  </section>;
}
