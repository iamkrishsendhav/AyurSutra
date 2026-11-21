import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Search, Users } from 'lucide-react';
import authFetch from '../../utils/apiClient';

const API = '/api/admin/patients';
const statuses = ['all', 'active', 'suspended'];

export default function AdminPatientManagement() {
  const [patients, setPatients] = useState([]);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [accountStatus, setAccountStatus] = useState('all');
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState(null);
  const [accountStatusDraft, setAccountStatusDraft] = useState('active');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingStatus, setSavingStatus] = useState(false);

  const loadPatients = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ q: search, accountStatus });
      const response = await authFetch(`${API}?${params}`);
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Admin sign-in is required to view patient records.' : 'Unable to load patient records.');
      const body = await response.json();
      setPatients(Array.isArray(body.patients) ? body.patients : []);
    } catch (requestError) { setError(requestError.message || 'Unable to load patient records.'); }
    finally { setLoading(false); }
  }, [search, accountStatus]);

  useEffect(() => { loadPatients(); }, [loadPatients]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let active = true;
    setError('');
    authFetch(`${API}/${selectedId}`).then(async (response) => {
      if (!response.ok) throw new Error('Unable to load patient summary.');
      return response.json();
    }).then((body) => { if (active) { setDetail(body); setAccountStatusDraft(body.patient.accountStatus || 'active'); } })
      .catch((requestError) => { if (active) setError(requestError.message); });
    return () => { active = false; };
  }, [selectedId]);

  if (selectedId) return <section className="rounded-2xl border border-amber-100 bg-[#FDF7E9] p-5 text-amber-950 shadow-sm sm:p-7">
    <button type="button" onClick={() => { setSelectedId(''); setError(''); }} className="mb-5 inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-medium"><ArrowLeft className="h-4 w-4" /> Back to patients</button>
    {!detail && !error && <p role="status">Loading patient summary…</p>}
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">{error}</p>}
    {detail && <>
      <div className="rounded-xl border border-amber-200 bg-white p-5">
        <h2 className="text-2xl font-semibold">{detail.patient.name}</h2>
        <p className="mt-1 text-sm text-gray-600">{detail.patient.email} · {detail.patient.phone || 'No phone provided'}</p>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <p><strong>Account status:</strong> <span className="capitalize">{detail.patient.accountStatus || 'active'}</span></p>
          <p><strong>Patient care status:</strong> <span className="capitalize">{detail.patient.status || 'pending'}</span></p>
          <p><strong>Registered:</strong> {new Date(detail.patient.createdAt).toLocaleDateString()}</p>
          <p><strong>Assigned practitioner:</strong> {detail.patient.assignedPractitioner?.name || 'Unassigned'}</p>
          <p><strong>Generated-session progress:</strong> {detail.summary.progress === null ? 'Not started' : `${detail.summary.progress}%`} · {detail.summary.completedSessionCount} of {detail.summary.generatedSessionCount} generated sessions completed ({detail.summary.cancelledSessionCount} cancelled)</p>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="text-sm font-medium">Administrative account access
          <select value={accountStatusDraft} onChange={(event) => setAccountStatusDraft(event.target.value)} className="mt-1 block rounded-lg border border-amber-200 bg-white px-3 py-2">
            <option value="active">Active</option><option value="suspended">Suspended</option>
          </select>
        </label>
        <button type="button" disabled={savingStatus} onClick={async () => {
          setSavingStatus(true); setError('');
          try {
            const response = await authFetch(`${API}/${selectedId}/account-status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountStatus: accountStatusDraft }) });
            const body = await response.json();
            if (!response.ok) throw new Error(body.message || 'Unable to update account status.');
            setDetail((current) => ({ ...current, patient: { ...current.patient, ...body.patient } }));
            await loadPatients();
          } catch (requestError) { setError(requestError.message); }
          finally { setSavingStatus(false); }
        }} className="rounded-lg bg-amber-700 px-4 py-2 font-medium text-white disabled:opacity-60">{savingStatus ? 'Saving…' : 'Save account status'}</button>
      </div>
      {detail.patient.accountStatusHistory?.length > 0 && <p className="mt-2 text-xs text-gray-600">Last access change: {new Date(detail.patient.accountStatusHistory.at(-1).changedAt).toLocaleString()}</p>}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border border-amber-200 bg-white p-5">
          <h3 className="mb-3 text-lg font-semibold">Treatment plans</h3>
          {detail.summary.plans.length ? detail.summary.plans.map((plan) => <article key={plan._id} className="mb-3 rounded-lg bg-amber-50 p-3">
            <p className="font-medium capitalize">{plan.title || 'Treatment plan'} · {plan.status} · {plan.therapies.map((item) => item.therapyType).join(', ')}</p>
            <p className="mt-1 text-sm">Start: {new Date(plan.startDate).toLocaleDateString()} · {plan.generatedAt ? 'Sessions generated' : 'Sessions not generated'}</p>
          </article>) : <p className="text-sm text-gray-600">No treatment plans recorded.</p>}
          <p className="mt-4 text-sm text-gray-600">Assessment records: {detail.summary.assessmentCount}</p>
        </section>
        <section className="rounded-xl border border-amber-200 bg-white p-5">
          <h3 className="mb-3 text-lg font-semibold">Therapy sessions</h3>
          {detail.summary.sessions.length ? <div className="max-h-96 space-y-2 overflow-y-auto">{detail.summary.sessions.map((session, index) => <article key={`${session.date}-${session.startTime}-${index}`} className="rounded-lg bg-amber-50 p-3">
            <p className="font-medium">{session.sessionName || session.therapyType} · <span className="capitalize">{session.status}</span></p>
            <p className="text-sm">{new Date(session.date).toLocaleDateString()} at {session.startTime} · {session.durationMins || 60} min</p>
          </article>)}</div> : <p className="text-sm text-gray-600">No therapy sessions recorded.</p>}
        </section>
      </div>
      <p className="mt-5 rounded-lg bg-amber-100/70 p-3 text-sm text-amber-900">Administrative view only. Clinical assessments and treatment decisions are not editable here.</p>
    </>}
  </section>;

  return <section className="rounded-2xl border border-amber-100 bg-[#FDF7E9] p-5 text-amber-950 shadow-sm sm:p-7">
    <div className="mb-5 flex items-center gap-3"><Users className="h-7 w-7 text-amber-700" /><div><h2 className="text-2xl font-semibold">Patient Management</h2><p className="text-sm text-gray-600">Search patient accounts and review treatment/session summaries.</p></div></div>
    <form onSubmit={(event) => { event.preventDefault(); setSearch(query.trim()); }} className="mb-5 flex flex-col gap-3 sm:flex-row">
      <label className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email, or phone" className="w-full rounded-lg border border-amber-200 bg-white py-2 pl-9 pr-3" /></label>
      <select aria-label="Filter patient account status" value={accountStatus} onChange={(event) => setAccountStatus(event.target.value)} className="rounded-lg border border-amber-200 bg-white px-3 py-2">{statuses.map((item) => <option key={item} value={item}>{item === 'all' ? 'All account statuses' : item[0].toUpperCase() + item.slice(1)}</option>)}</select>
      <button className="rounded-lg bg-amber-700 px-4 py-2 font-medium text-white">Search</button>
    </form>
    {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">{error}</p>}
    {loading ? <p role="status">Loading patients…</p> : patients.length === 0 ? <p className="rounded-lg bg-white p-5 text-center text-sm text-gray-600">No patients match this search.</p> : <div className="overflow-x-auto rounded-xl border border-amber-200 bg-white"><table className="min-w-full divide-y divide-amber-100 text-left text-sm"><thead className="bg-amber-50"><tr>{['Patient', 'Account status', 'Practitioner', 'Registered', ''].map((heading) => <th key={heading} className="px-4 py-3 font-semibold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-amber-50">{patients.map((patient) => <tr key={patient._id}><td className="px-4 py-3"><p className="font-medium">{patient.name}</p><p className="text-gray-600">{patient.email}</p></td><td className="px-4 py-3 capitalize">{patient.accountStatus || 'active'}</td><td className="px-4 py-3">{patient.assignedPractitioner?.name || 'Unassigned'}</td><td className="px-4 py-3">{new Date(patient.createdAt).toLocaleDateString()}</td><td className="px-4 py-3 text-right"><button type="button" onClick={() => setSelectedId(patient._id)} className="rounded-lg border border-amber-300 px-3 py-1.5 font-medium text-amber-900 hover:bg-amber-50">View summary</button></td></tr>)}</tbody></table></div>}
  </section>;
}
