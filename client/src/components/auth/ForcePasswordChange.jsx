import React, { useState } from 'react';
import { KeyRound } from 'lucide-react';
import authFetch from '../../utils/apiClient';

export default function ForcePasswordChange({ user, onComplete }) {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    if (form.newPassword.length < 6 || form.newPassword.length > 128) { setError('New password must be between 6 and 128 characters.'); setBusy(false); return; }
    if (form.newPassword !== form.confirmPassword) { setError('Password confirmation does not match.'); setBusy(false); return; }
    try {
      const response = await authFetch('/api/auth/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Password could not be updated');
      onComplete();
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };
  return <main className="flex min-h-screen items-center justify-center bg-[#FDF7E9] px-4 py-8"><form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-2xl border border-amber-200 bg-white p-6 shadow-sm"><div className="flex items-center gap-3"><span className="rounded-full bg-amber-100 p-3 text-amber-800"><KeyRound className="h-5 w-5"/></span><div><p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Account setup</p><h1 className="text-xl font-semibold text-amber-950">Choose a new password</h1></div></div><p className="text-sm text-amber-800">{user?.name || 'Your account'} must set a personal password before continuing.</p>{error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}<label className="block text-sm">Temporary password<input required autoComplete="current-password" type="password" value={form.currentPassword} onChange={(event) => setForm({ ...form, currentPassword: event.target.value })} className="mt-1 block w-full"/></label><label className="block text-sm">New password (6 characters minimum)<input required minLength="6" maxLength="128" autoComplete="new-password" type="password" value={form.newPassword} onChange={(event) => setForm({ ...form, newPassword: event.target.value })} className="mt-1 block w-full"/></label><label className="block text-sm">Confirm new password<input required minLength="6" maxLength="128" autoComplete="new-password" type="password" value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} className="mt-1 block w-full"/></label><button disabled={busy} className="w-full rounded-lg bg-amber-700 px-4 py-3 font-medium text-white disabled:opacity-60">{busy ? 'Updating…' : 'Set password and continue'}</button></form></main>;
}
