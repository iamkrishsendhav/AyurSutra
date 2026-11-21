import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Plus, Search, Stethoscope } from 'lucide-react';
import authFetch from '../../utils/apiClient';
import AvailabilityEditor from '../scheduling/AvailabilityEditor';

const API = '/api/admin/practitioners';

export default function AdminPractitionerManagement() {
  const [practitioners, setPractitioners] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState(null);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [registerForm, setRegisterForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [edit, setEdit] = useState({});

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ q: search, status });
      const response = await authFetch(`${API}?${params}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Unable to load practitioners');
      setPractitioners(Array.isArray(body.practitioners) ? body.practitioners : []);
    } catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }, [search, status]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let active = true;
    setDetail(null); setError('');
    authFetch(`${API}/${selectedId}`).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Unable to load practitioner details');
      return body;
    }).then((body) => {
      if (!active) return;
      setDetail(body);
      const practitioner = body.practitioner;
      setEdit({
        name: practitioner.name || '', phone: practitioner.phone || '', profileImageUrl: practitioner.profileImageUrl || '',
        licenseNumber: practitioner.licenseNumber || '', qualifications: (practitioner.qualifications || []).join(', '),
        practiceAreas: (practitioner.practiceAreas || []).join(', '), experience: practitioner.experience || 0,
        bio: practitioner.bio || '', professionalStatus: practitioner.professionalStatus || 'active',
        availableForNewPatients: practitioner.availableForNewPatients !== false,
        availabilitySchedule: practitioner.availabilitySchedule || [], practiceLocation: practitioner.practiceLocation || {},
      });
    }).catch((requestError) => { if (active) setError(requestError.message); });
    return () => { active = false; };
  }, [selectedId]);

  const registerPractitioner = async (event) => {
    event.preventDefault(); setError(''); setNotice('');
    try {
      const response = await authFetch('/api/admin/staff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...registerForm, userType: 'practitioner' }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Practitioner account could not be created');
      setNotice(`Practitioner account created for ${body.staff?.email || registerForm.email}. Verification remains pending.`);
      setRegisterForm({ name: '', email: '', phone: '', password: '' }); setShowRegister(false); await load();
    } catch (requestError) { setError(requestError.message); }
  };

  const savePractitioner = async (event) => {
    event.preventDefault(); setError(''); setNotice(''); setSaving(true);
    const payload = {
      ...edit,
      experience: Number(edit.experience),
      qualifications: edit.qualifications.split(',').map((item) => item.trim()).filter(Boolean),
      practiceAreas: edit.practiceAreas.split(',').map((item) => item.trim()).filter(Boolean),
    };
    try {
      const response = await authFetch(`${API}/${selectedId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Profile could not be saved');
      setNotice('Practitioner profile updated.');
      setDetail((current) => ({ ...current, practitioner: { ...current.practitioner, ...body.practitioner } }));
      await load();
    } catch (requestError) { setError(requestError.message); }
    finally { setSaving(false); }
  };

  if (selectedId) return <section className="space-y-5 rounded-2xl border border-amber-100 bg-[#FDF7E9] p-5 text-amber-950 sm:p-7">
    <button type="button" onClick={() => { setSelectedId(''); setError(''); setNotice(''); }} className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm"><ArrowLeft className="h-4 w-4" /> Practitioner directory</button>
    {!detail && !error && <p role="status">Loading practitioner details…</p>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-green-800">{notice}</p>}
    {detail && <>
      <header className="flex flex-col gap-4 rounded-xl border border-amber-200 bg-white p-5 sm:flex-row sm:items-center">
        {detail.practitioner.profileImageUrl ? <img src={detail.practitioner.profileImageUrl} alt={`${detail.practitioner.name} profile`} className="h-20 w-20 rounded-full object-cover" /> : <div className="flex h-20 w-20 items-center justify-center rounded-full bg-amber-100"><Stethoscope className="h-8 w-8 text-amber-700" /></div>}
        <div><h1 className="text-2xl font-semibold">{detail.practitioner.name}</h1><p className="text-sm text-gray-600">{detail.practitioner.email} · {detail.practitioner.phone || 'No phone provided'}</p><p className="mt-1 text-sm">{detail.practitioner.experience || 0} years experience · Verification: {detail.practitioner.verificationStatus || 'pending'} · Status: {detail.practitioner.professionalStatus}</p></div>
      </header>
      <div className="grid gap-4 sm:grid-cols-3">{[['Assigned patients', detail.patients.length], ['Upcoming sessions', detail.sessions.filter((item) => ['scheduled', 'confirmed'].includes(item.status) && new Date(item.date) >= new Date()).length], ['Completed sessions', detail.sessions.filter((item) => item.status === 'completed').length]].map(([label, value]) => <div key={label} className="rounded-xl border border-amber-200 bg-white p-4"><p className="text-sm text-gray-600">{label}</p><p className="text-2xl font-semibold">{value}</p></div>)}</div>
      <form onSubmit={savePractitioner} className="grid gap-4 rounded-xl border border-amber-200 bg-white p-5 md:grid-cols-2">
        <h2 className="text-lg font-semibold md:col-span-2">Professional profile and availability</h2>
        {notice && <p role="status" className="text-green-800 md:col-span-2">{notice}</p>}
        <label className="text-sm font-medium">Name<input value={edit.name || ''} onChange={(event) => setEdit({ ...edit, name: event.target.value })} className="mt-1 block w-full rounded border p-2" /></label>
        <label className="text-sm font-medium">Phone<input value={edit.phone || ''} onChange={(event) => setEdit({ ...edit, phone: event.target.value })} className="mt-1 block w-full rounded border p-2" /></label>
        <label className="text-sm font-medium">Profile image HTTPS URL<input value={edit.profileImageUrl || ''} onChange={(event) => setEdit({ ...edit, profileImageUrl: event.target.value })} className="mt-1 block w-full rounded border p-2" /></label>
        <label className="text-sm font-medium">License / registration number<input value={edit.licenseNumber || ''} onChange={(event) => setEdit({ ...edit, licenseNumber: event.target.value })} className="mt-1 block w-full rounded border p-2" /></label>
        <label className="text-sm font-medium">Qualifications (comma-separated)<input value={edit.qualifications || ''} onChange={(event) => setEdit({ ...edit, qualifications: event.target.value })} className="mt-1 block w-full rounded border p-2" /></label>
        <label className="text-sm font-medium">Panchakarma skills (comma-separated)<input value={edit.practiceAreas || ''} onChange={(event) => setEdit({ ...edit, practiceAreas: event.target.value })} className="mt-1 block w-full rounded border p-2" /></label>
        <label className="text-sm font-medium">Experience (years)<input type="number" min="0" max="80" value={edit.experience ?? 0} onChange={(event) => setEdit({ ...edit, experience: event.target.value })} className="mt-1 block w-full rounded border p-2" /></label>
        <label className="text-sm font-medium">Professional status<select value={edit.professionalStatus || 'active'} onChange={(event) => setEdit({ ...edit, professionalStatus: event.target.value })} className="mt-1 block w-full rounded border p-2"><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.availableForNewPatients !== false} onChange={(event) => setEdit({ ...edit, availableForNewPatients: event.target.checked })} />Accepting new patients</label>
        <label className="text-sm font-medium md:col-span-2">Professional biography<textarea rows="3" maxLength="5000" value={edit.bio || ''} onChange={(event) => setEdit({ ...edit, bio: event.target.value })} className="mt-1 block w-full rounded border p-2" /></label>
        <div className="md:col-span-2"><p className="mb-2 text-sm font-medium">Weekly availability</p><AvailabilityEditor value={edit.availabilitySchedule || []} onChange={(availabilitySchedule) => setEdit({ ...edit, availabilitySchedule })} /></div>
        <button disabled={saving} className="rounded-lg bg-amber-700 px-4 py-2 text-white disabled:opacity-50 md:col-span-2">{saving ? 'Saving…' : 'Save practitioner profile'}</button>
      </form>
      <div className="grid gap-5 lg:grid-cols-2"><section className="rounded-xl border border-amber-200 bg-white p-5"><h2 className="mb-3 text-lg font-semibold">Assigned patients ({detail.patients.length})</h2>{detail.patients.length ? detail.patients.map((patient) => <p key={patient._id} className="border-b border-amber-50 py-2">{patient.name} · {patient.email} · {patient.currentStage || 'Initial Assessment'}</p>) : <p className="text-sm text-gray-600">No assigned patients.</p>}</section>
        <section className="rounded-xl border border-amber-200 bg-white p-5"><h2 className="mb-3 text-lg font-semibold">Session workload</h2>{detail.sessions.length ? <div className="max-h-80 space-y-2 overflow-y-auto">{detail.sessions.map((session) => <article key={session._id} className="rounded-lg bg-amber-50 p-3"><p className="font-medium">{session.patient?.name || 'Unassigned slot'} · {session.sessionName || session.therapyType}</p><p className="text-sm">{new Date(session.date).toLocaleDateString()} at {session.startTime} · <span className="capitalize">{session.status}</span></p></article>)}</div> : <p className="text-sm text-gray-600">No sessions recorded.</p>}</section></div>
    </>}
  </section>;

  return <section className="space-y-5 rounded-2xl border border-amber-100 bg-[#FDF7E9] p-5 text-amber-950 sm:p-7">
    <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h1 className="text-2xl font-semibold">Practitioner Management</h1><p className="text-sm text-gray-600">Manage professional profiles, availability, patient assignment and workload.</p></div><button onClick={() => setShowRegister((value) => !value)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-700 px-4 py-2 text-white"><Plus className="h-4 w-4" /> Register practitioner</button></header>
    {notice && !selectedId && <p role="status" className="rounded-lg bg-green-50 p-3 text-green-800">{notice}</p>}{error && !selectedId && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
    {showRegister && <form onSubmit={registerPractitioner} className="grid gap-3 rounded-xl border border-amber-200 bg-white p-5 sm:grid-cols-2"><h2 className="text-lg font-semibold sm:col-span-2">Create practitioner account through existing signup</h2><label className="text-sm">Name<input required value={registerForm.name} onChange={(event) => setRegisterForm({ ...registerForm, name: event.target.value })} className="mt-1 block w-full rounded border p-2" /></label><label className="text-sm">Email<input required type="email" value={registerForm.email} onChange={(event) => setRegisterForm({ ...registerForm, email: event.target.value })} className="mt-1 block w-full rounded border p-2" /></label><label className="text-sm">Phone<input value={registerForm.phone} onChange={(event) => setRegisterForm({ ...registerForm, phone: event.target.value })} className="mt-1 block w-full rounded border p-2" /></label><label className="text-sm">Temporary password (6 to 128 characters)<input required minLength="6" maxLength="128" type="password" value={registerForm.password} onChange={(event) => setRegisterForm({ ...registerForm, password: event.target.value })} className="mt-1 block w-full rounded border p-2" /></label><button className="rounded-lg bg-amber-700 px-4 py-2 text-white sm:col-span-2">Create practitioner account</button><p className="text-xs text-gray-600 sm:col-span-2">Share the initial password securely with the practitioner; verification status remains pending until reviewed.</p></form>}
    <form onSubmit={(event) => { event.preventDefault(); setSearch(query.trim()); }} className="grid gap-3 sm:grid-cols-[1fr_auto_auto]"><label className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email, phone, or skill" className="w-full rounded-lg border border-amber-200 bg-white py-2 pl-9 pr-3" /></label><select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter professional status" className="rounded-lg border border-amber-200 bg-white px-3 py-2"><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select><button className="rounded-lg border border-amber-300 px-4 py-2 sm:col-span-3 sm:justify-self-end">Search</button></form>
    {loading ? <p role="status">Loading practitioners…</p> : practitioners.length === 0 ? <p className="rounded-xl bg-white p-5 text-center text-sm text-gray-600">No practitioners found.</p> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{practitioners.map((practitioner) => <button key={practitioner._id} type="button" onClick={() => { setNotice(''); setSelectedId(practitioner._id); }} className="rounded-xl border border-amber-200 bg-white p-5 text-left shadow-sm hover:border-amber-400"><div className="flex items-center gap-3">{practitioner.profileImageUrl ? <img src={practitioner.profileImageUrl} alt="" className="h-12 w-12 rounded-full object-cover" /> : <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100"><Stethoscope className="h-6 w-6 text-amber-700" /></div>}<div><h2 className="font-semibold">{practitioner.name}</h2><p className="text-sm text-gray-600">{practitioner.email}</p></div></div><p className="mt-3 text-sm">{practitioner.qualifications?.join(', ') || 'Qualifications not recorded'}</p><p className="text-sm">Skills: {practitioner.practiceAreas?.join(', ') || 'Not recorded'}</p><div className="mt-3 flex flex-wrap gap-2 text-xs"><span className="rounded bg-amber-100 px-2 py-1">{practitioner.assignedPatientCount} patients</span><span className="rounded bg-blue-100 px-2 py-1">{practitioner.upcomingSessionCount} upcoming</span><span className="rounded bg-green-100 px-2 py-1">{practitioner.completedSessionCount} completed</span><span className="rounded bg-gray-100 px-2 py-1">{practitioner.professionalStatus}</span></div></button>)}</div>}
  </section>;
}
