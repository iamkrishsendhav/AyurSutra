import React, { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Search, ShieldCheck, Stethoscope } from 'lucide-react';
import authFetch from '../../utils/apiClient';

const emptyForm = { name: '', email: '', phone: '', userType: 'practitioner', employeeId: '', joiningDate: '', profileImageUrl: '', password: '' };

export default function AdminStaffManagement() {
  const [staff, setStaff] = useState([]);
  const [editingId, setEditingId] = useState('');
  const [resettingId, setResettingId] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [editForm, setEditForm] = useState({ name: '', phone: '', profileImageUrl: '', employeeId: '', joiningDate: '' });
  const [form, setForm] = useState(emptyForm);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await authFetch('/api/admin/staff');
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Unable to load staff accounts');
      setStaff(Array.isArray(body.staff) ? body.staff : []);
    } catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const response = await authFetch('/api/admin/staff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, joiningDate: form.userType === 'receptionist' ? (form.joiningDate || new Date().toISOString()) : undefined }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Staff account could not be created');
      setNotice(`${body.staff.userType === 'receptionist' ? 'Receptionist' : 'Vaidya'} account created for ${body.staff.email}. Share the temporary password securely.`);
      setForm(emptyForm); await load();
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };

  const setStatus = async (person) => {
    setError(''); setNotice('');
    const accountStatus = person.accountStatus === 'suspended' ? 'active' : 'suspended';
    try {
      const response = await authFetch(`/api/admin/staff/${person._id}/account-status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountStatus }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Account status could not be updated');
      setStaff((current) => current.map((item) => item._id === person._id ? { ...item, accountStatus } : item));
    } catch (requestError) { setError(requestError.message); }
  };

  const saveProfile = async (event) => {
    event.preventDefault(); setError(''); setNotice('');
    try {
      const person = staff.find((item) => item._id === editingId);
      const payload = person?.userType === 'receptionist' ? editForm : { name: editForm.name, phone: editForm.phone, profileImageUrl: editForm.profileImageUrl };
      const response = await authFetch(`/api/admin/staff/${editingId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await response.json(); if (!response.ok) throw new Error(body.message || 'Staff profile could not be updated');
      setStaff((current) => current.map((item) => item._id === editingId ? { ...item, ...body.staff } : item)); setEditingId(''); setNotice('Staff profile updated.');
    } catch (requestError) { setError(requestError.message); }
  };

  const resetPassword = async (event) => {
    event.preventDefault(); if (!resettingId) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await authFetch(`/api/admin/staff/${resettingId}/reset-password`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: temporaryPassword }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.message || 'Password reset failed');
      setNotice(`Temporary password reset for ${body.staff.email}; the user must change it after login.`); setTemporaryPassword(''); setResettingId('');
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };

  const filtered = staff.filter((person) => `${person.name} ${person.email} ${person.employeeId || ''} ${person.userType}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="space-y-5 rounded-2xl border border-amber-200 bg-[#FDF7E9] p-5 text-amber-950 sm:p-7">
    <header><p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Secure staff access</p><h1 className="mt-1 text-2xl font-semibold">Vaidya & Receptionist Accounts</h1><p className="mt-1 text-sm text-amber-800">Create staff accounts and suspend or reactivate access. Temporary passwords are not returned by the server.</p></header>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}{notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
    <form onSubmit={create} className="grid gap-3 rounded-xl border border-amber-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-3">
      <h2 className="flex items-center gap-2 font-semibold sm:col-span-2 lg:col-span-3"><Plus className="h-4 w-4"/>Create staff account</h2>
      <label className="text-sm">Role<select value={form.userType} onChange={(event) => setForm({ ...form, userType: event.target.value })} className="mt-1 block w-full"><option value="practitioner">Vaidya / Practitioner</option><option value="receptionist">Receptionist</option></select></label>
      <label className="text-sm">Full name<input required minLength="2" maxLength="120" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-1 block w-full" /></label>
      <label className="text-sm">Email<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="mt-1 block w-full" /></label>
      <label className="text-sm">Phone<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className="mt-1 block w-full" /></label>
      {form.userType === 'receptionist' && <label className="text-sm">Employee ID<input required minLength="2" maxLength="40" value={form.employeeId} onChange={(event) => setForm({ ...form, employeeId: event.target.value })} className="mt-1 block w-full" /></label>}
      {form.userType === 'receptionist' && <label className="text-sm">Joining date<input type="date" value={form.joiningDate} onChange={(event) => setForm({ ...form, joiningDate: event.target.value })} className="mt-1 block w-full" /></label>}
      <label className="text-sm">Profile image URL (optional)<input type="url" value={form.profileImageUrl} onChange={(event) => setForm({ ...form, profileImageUrl: event.target.value })} placeholder="https://…" className="mt-1 block w-full" /></label>
      <label className="text-sm">Temporary password<input required minLength="6" maxLength="128" type="password" autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} className="mt-1 block w-full" /><span className="mt-1 block text-xs text-gray-500">6 to 128 characters; share through a secure channel.</span></label>
      <button disabled={busy} className="self-end rounded-lg bg-amber-700 px-4 py-2.5 font-medium text-white disabled:opacity-60 sm:col-span-2 lg:col-span-3">{busy ? 'Creating…' : 'Create account'}</button>
    </form>
    <div className="relative max-w-lg"><Search className="absolute left-3 top-1/2 h-4 w-4 text-gray-400"/><input aria-label="Search staff" placeholder="Search name, email, employee ID" value={query} onChange={(event) => setQuery(event.target.value)} className="w-full pl-9" /></div>
    {loading ? <p role="status">Loading staff accounts…</p> : filtered.length ? <div className="grid gap-3 md:grid-cols-2">{filtered.map((person) => <article key={person._id} className="rounded-xl border border-amber-200 bg-white p-4"><div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3">{person.profileImageUrl ? <img src={person.profileImageUrl} alt="" className="h-11 w-11 rounded-full object-cover"/> : <span className="rounded-full bg-amber-100 p-3 text-amber-800">{person.userType === 'receptionist' ? <ShieldCheck className="h-5 w-5"/> : <Stethoscope className="h-5 w-5"/>}</span>}<div><h3 className="font-semibold">{person.name}</h3><p className="text-sm text-gray-600">{person.email} · {person.phone || 'No phone'}</p></div></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${person.accountStatus === 'suspended' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>{person.accountStatus || 'active'}</span></div><p className="mt-3 text-sm capitalize">{person.userType === 'practitioner' ? 'Vaidya / Practitioner' : 'Receptionist'}{person.employeeId ? ` · Employee ID ${person.employeeId}` : ''}{person.joiningDate ? ` · Joined ${new Date(person.joiningDate).toLocaleDateString()}` : ''}</p>{editingId === person._id ? <form onSubmit={saveProfile} className="mt-3 grid gap-2 sm:grid-cols-2"><label className="text-xs">Name<input required value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} className="mt-1 block w-full"/></label><label className="text-xs">Phone<input value={editForm.phone} onChange={(event) => setEditForm({ ...editForm, phone: event.target.value })} className="mt-1 block w-full"/></label><label className="text-xs sm:col-span-2">Profile image HTTPS URL<input type="url" value={editForm.profileImageUrl} onChange={(event) => setEditForm({ ...editForm, profileImageUrl: event.target.value })} className="mt-1 block w-full"/></label>{person.userType === 'receptionist' && <><label className="text-xs">Employee ID<input required value={editForm.employeeId} onChange={(event) => setEditForm({ ...editForm, employeeId: event.target.value })} className="mt-1 block w-full"/></label><label className="text-xs">Joining date<input type="date" value={editForm.joiningDate ? new Date(editForm.joiningDate).toISOString().slice(0,10) : ''} onChange={(event) => setEditForm({ ...editForm, joiningDate: event.target.value })} className="mt-1 block w-full"/></label></>}<button className="rounded-lg bg-amber-700 px-3 py-2 text-sm text-white">Save profile</button><button type="button" onClick={() => setEditingId('')} className="rounded-lg border border-amber-300 px-3 py-2 text-sm">Cancel</button></form> : <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => { setEditingId(person._id); setEditForm({ name: person.name || '', phone: person.phone || '', profileImageUrl: person.profileImageUrl || '', employeeId: person.employeeId || '', joiningDate: person.joiningDate || '' }); }} className="inline-flex items-center gap-1 rounded-lg border border-amber-300 px-3 py-2 text-sm hover:bg-amber-50"><Pencil className="h-3.5 w-3.5"/>Edit profile</button><button type="button" onClick={() => setStatus(person)} className="rounded-lg border border-amber-300 px-3 py-2 text-sm hover:bg-amber-50">{person.accountStatus === 'suspended' ? 'Reactivate account' : 'Suspend account'}</button><button type="button" onClick={() => { setResettingId(person._id); setTemporaryPassword(''); }} className="rounded-lg border border-amber-300 px-3 py-2 text-sm hover:bg-amber-50">Reset password</button></div>}{resettingId === person._id && <form onSubmit={resetPassword} className="mt-3 flex flex-wrap gap-2"><label className="min-w-48 flex-1 text-xs">Temporary password<input required minLength="6" maxLength="128" type="password" autoComplete="new-password" value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} className="mt-1 block w-full"/></label><button disabled={busy} className="self-end rounded-lg bg-amber-700 px-3 py-2 text-sm text-white">Set & require change</button><button type="button" onClick={() => setResettingId('')} className="self-end rounded-lg border border-amber-300 px-3 py-2 text-sm">Cancel</button></form>}</article>)}</div> : <p className="rounded-xl border border-dashed border-amber-300 bg-white p-6 text-center text-sm text-amber-800">No staff accounts match this search.</p>}
  </section>;
}
