import React, { useEffect, useState } from 'react';
import { Bell, Mail, Save } from 'lucide-react';
import authFetch from '../../utils/apiClient';

const categories = [
  ['appointment-booked', 'Appointment booked'], ['appointment-confirmed', 'Appointment confirmed'],
  ['appointment-rescheduled', 'Appointment rescheduled'], ['appointment-cancelled', 'Appointment cancelled'],
  ['session-reminder', 'Session reminders'], ['plan-submitted', 'Treatment plan submitted'],
  ['plan-approved', 'Treatment plan approved'], ['plan-rejected', 'Treatment plan declined'],
  ['session-started', 'Session started'], ['session-completed', 'Session completed'],
  ['follow-up-scheduled', 'Follow-up scheduled'], ['follow-up-completed', 'Follow-up completed'],
  ['feedback-received', 'Patient feedback'], ['patient-assigned', 'Patient assignment'], ['admin-update', 'Administrative updates'],
];

async function readBody(response) { let body = {}; try { body = await response.json(); } catch { /* Keep the response error generic when the body is not JSON. */ } if (!response.ok) throw new Error(body.message || 'Could not save preferences'); return body; }

export default function NotificationPreferences() {
  const [preferences, setPreferences] = useState({ inApp: true, categories: {}, sessionReminders: true, followUpReminders: true, email: false });
  const [emailAvailable, setEmailAvailable] = useState(false);
  const [state, setState] = useState('loading');
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    authFetch('/api/notifications/preferences').then(readBody).then((data) => { if (!active) return; setPreferences({ ...preferences, ...data.preferences, categories: data.preferences?.categories || {} }); setEmailAvailable(Boolean(data.emailAvailable)); setState('loaded'); }).catch((error) => { if (active) { setMessage(error.message); setState('error'); } });
    return () => { active = false; };
  }, []);
  const setCategory = (key, enabled) => setPreferences((value) => ({ ...value, categories: { ...value.categories, [key]: enabled } }));
  const save = async () => {
    setState('saving'); setMessage('');
    try {
      const response = await authFetch('/api/notifications/preferences', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(preferences) });
      const data = await readBody(response); setPreferences({ ...preferences, ...data.preferences, categories: data.preferences?.categories || {} }); setState('loaded'); setMessage('Preferences saved.');
    } catch (error) { setState('error'); setMessage(error.message); }
  };
  const checkbox = (label, checked, onChange, disabled = false) => <label className="flex items-center gap-2 text-sm text-amber-900"><input type="checkbox" checked={Boolean(checked)} disabled={disabled || state === 'loading' || state === 'saving'} onChange={(event) => onChange(event.target.checked)} className="accent-amber-700"/>{label}</label>;
  return <section className="rounded-lg border border-amber-100 bg-gradient-to-br from-amber-50/50 to-orange-50/50 p-5 shadow-sm">
    <div className="mb-3 flex items-center gap-2"><Bell className="h-5 w-5 text-orange-600"/><h3 className="text-lg font-semibold text-amber-900">Notification preferences</h3></div>
    {state === 'loading' ? <p role="status" className="text-sm text-amber-800">Loading preferences…</p> : <>
      <div className="mb-4 flex flex-wrap gap-x-6 gap-y-2">
        {checkbox('In-app notifications', preferences.inApp, (value) => setPreferences((current) => ({ ...current, inApp: value })))}
        {checkbox('Session reminders', preferences.sessionReminders, (value) => setPreferences((current) => ({ ...current, sessionReminders: value })))}
        {checkbox('Follow-up reminders', preferences.followUpReminders, (value) => setPreferences((current) => ({ ...current, followUpReminders: value })))}
        {checkbox(<span className="inline-flex items-center gap-1"><Mail className="h-4 w-4"/>Email delivery {emailAvailable ? '' : '(not configured)'}</span>, preferences.email, (value) => setPreferences((current) => ({ ...current, email: value })), !emailAvailable)}
      </div>
      <details><summary className="cursor-pointer text-sm font-medium text-amber-800">Choose notification categories</summary><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{categories.map(([key, label]) => checkbox(label, preferences.categories?.[key] !== false, (value) => setCategory(key, value)))}</div></details>
      <div className="mt-4 flex flex-wrap items-center gap-3"><button onClick={save} disabled={state === 'saving'} className="inline-flex items-center gap-2 rounded bg-amber-700 px-3 py-2 text-sm text-white disabled:opacity-60"><Save className="h-4 w-4"/>{state === 'saving' ? 'Saving…' : 'Save preferences'}</button>{message && <p role={state === 'error' ? 'alert' : 'status'} className="text-sm text-amber-800">{message}</p>}</div>
    </>}
  </section>;
}
