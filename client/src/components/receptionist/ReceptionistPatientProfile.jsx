import React, { useEffect, useState } from 'react';
import { CalendarDays, Clock3, ClipboardList, UserRound, X } from 'lucide-react';
import authFetch from '../../utils/apiClient';

const formatDate = (value) => value ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

export default function ReceptionistPatientProfile({ patientId, onClose }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    authFetch(`/api/receptionist/patients/${encodeURIComponent(patientId)}/profile`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.message || 'Patient profile could not be loaded');
        if (active) setProfile(body);
      })
      .catch((requestError) => { if (active) setError(requestError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [patientId]);

  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const patient = profile?.patient;
  return <div className="fixed inset-0 z-[120] flex justify-end bg-stone-950/35" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside role="dialog" aria-modal="true" aria-labelledby="patient-profile-title" className="flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-amber-200 bg-[#fffdf8] shadow-2xl">
      <header className="flex items-start justify-between gap-4 border-b border-amber-100 bg-gradient-to-r from-amber-50 to-orange-50 px-5 py-5 sm:px-7">
        <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-700">Patient record</p><h2 id="patient-profile-title" className="mt-1 truncate text-xl font-semibold text-amber-950">{loading ? 'Loading patient…' : patient?.name || 'Patient profile'}</h2>{patient && <p className="mt-1 break-all text-sm text-amber-800">{patient.email}</p>}</div>
        <button type="button" onClick={onClose} aria-label="Close patient profile" className="rounded-lg p-2 text-amber-800 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"><X className="h-5 w-5"/></button>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 sm:p-7">
        {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
        {loading && <div role="status" aria-label="Loading patient profile" className="space-y-3"><div className="h-24 animate-pulse rounded-xl bg-amber-100"/><div className="h-36 animate-pulse rounded-xl bg-amber-100"/><div className="h-48 animate-pulse rounded-xl bg-amber-100"/></div>}
        {!loading && patient && <>
          <section className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-amber-100 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Patient ID</p><p className="mt-1 break-all font-mono text-sm text-amber-950">{patient._id}</p></div>
            <div className="rounded-xl border border-amber-100 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Registered</p><p className="mt-1 text-sm text-amber-950">{formatDate(patient.createdAt)}</p></div>
            <div className="rounded-xl border border-amber-100 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Contact</p><p className="mt-1 text-sm text-amber-950">{patient.phone || 'No phone recorded'}</p></div>
            <div className="rounded-xl border border-amber-100 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Demographics</p><p className="mt-1 text-sm capitalize text-amber-950">{patient.personalDetails?.gender?.replaceAll('_', ' ') || 'Not recorded'}{patient.personalDetails?.dateOfBirth ? ` · DOB ${formatDate(patient.personalDetails.dateOfBirth)}` : ''}</p></div>
            <div className="rounded-xl border border-amber-100 bg-white p-4 sm:col-span-2"><p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Address</p><p className="mt-1 text-sm text-amber-950">{[patient.address?.street, patient.address?.city, patient.address?.state, patient.address?.pincode, patient.address?.country].filter(Boolean).join(', ') || 'No address recorded'}</p></div>
          </section>

          <section className="rounded-xl border border-amber-100 bg-white p-4 sm:p-5"><h3 className="flex items-center gap-2 font-semibold text-amber-950"><CalendarDays className="h-4 w-4 text-amber-700"/>Appointment & visit history</h3>
            {profile.appointments.length ? <ul className="mt-3 divide-y divide-amber-100">{profile.appointments.map((item) => <li key={item._id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><div><p className="font-medium text-amber-950">{item.sessionName || item.therapyType}</p><p className="text-xs text-amber-700">{item.practitioner?.name || 'Vaidya not assigned'} · {item.durationMins || 60} min</p></div><span className="text-right text-xs capitalize text-amber-800">{formatDate(item.date)} · {item.startTime}<br/>{item.status?.replace('-', ' ')}{item.checkedInAt && <><br/>Checked in {new Date(item.checkedInAt).toLocaleString()}</>}</span></li>)}</ul> : <p className="mt-3 text-sm text-stone-600">No appointment history is recorded.</p>}
          </section>

          <section className="rounded-xl border border-amber-100 bg-white p-4 sm:p-5"><h3 className="flex items-center gap-2 font-semibold text-amber-950"><ClipboardList className="h-4 w-4 text-amber-700"/>Vaidya-approved treatment plans</h3>
            {profile.approvedTreatmentPlans.length ? <div className="mt-3 space-y-3">{profile.approvedTreatmentPlans.map((plan) => <article key={plan._id} className="rounded-lg bg-amber-50/70 p-3"><p className="font-medium text-amber-950">{plan.title || 'Approved treatment plan'}</p><p className="text-xs text-amber-700">Starts {formatDate(plan.startDate)}</p><ul className="mt-2 space-y-1">{plan.therapies.map((therapy) => <li key={therapy._id} className="text-sm text-amber-900">{therapy.catalogSnapshot?.name || therapy.therapyType} · {therapy.phase} · {therapy.occurrences} sessions, every {therapy.frequencyDays} days</li>)}</ul></article>)}</div> : <p className="mt-3 text-sm text-stone-600">No approved plan is recorded.</p>}
          </section>

          <section className="rounded-xl border border-amber-100 bg-white p-4 sm:p-5"><h3 className="flex items-center gap-2 font-semibold text-amber-950"><Clock3 className="h-4 w-4 text-amber-700"/>Follow-up history</h3>
            {profile.followUps.length ? <ul className="mt-3 divide-y divide-amber-100">{profile.followUps.map((item) => <li key={item._id} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><span>With {item.practitioner?.name || 'Vaidya'}</span><span className="text-amber-800">{formatDate(item.dueAt)} · <span className="capitalize">{item.status}</span></span></li>)}</ul> : <p className="mt-3 text-sm text-stone-600">No follow-ups are recorded.</p>}
          </section>

          <section className="rounded-xl border border-amber-100 bg-white p-4 sm:p-5"><h3 className="flex items-center gap-2 font-semibold text-amber-950"><UserRound className="h-4 w-4 text-amber-700"/>Patient timeline</h3>
            {profile.timeline.length ? <ol className="mt-3 space-y-3 border-l border-amber-200 pl-4">{profile.timeline.map((item, index) => <li key={`${item.type}-${item.at}-${index}`} className="relative text-sm"><span className="absolute -left-[1.34rem] top-1.5 h-2 w-2 rounded-full bg-amber-600"/><p className="font-medium text-amber-950">{item.title}</p><p className="text-xs capitalize text-amber-700">{formatDate(item.at)} · {item.status?.replace('-', ' ')}{item.practitioner ? ` · ${item.practitioner}` : ''}</p></li>)}</ol> : <p className="mt-3 text-sm text-stone-600">No timeline events are recorded.</p>}
          </section>
        </>}
      </div>
    </aside>
  </div>;
}
