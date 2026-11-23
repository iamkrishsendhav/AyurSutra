import React, { useCallback, useEffect, useState } from 'react';
import { Clock3, ListPlus, RefreshCw, XCircle } from 'lucide-react';
import authFetch from '../../utils/apiClient';

export default function ReceptionistWaitlist({ date, patientId, practitionerId, therapyType, hasAvailableSlots, selectedWaitlistId, refreshKey = 0, onUseRequest, onRefreshAvailability }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await authFetch(`/api/receptionist/waitlist?date=${encodeURIComponent(date)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Waitlist could not be loaded');
      setEntries(body.waitlist || []);
    } catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }, [date]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const addToWaitlist = async () => {
    if (!patientId || !practitionerId || hasAvailableSlots) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await authFetch('/api/receptionist/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ patientId, practitionerId, date, therapyType }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Patient could not be added to the waitlist');
      setNotice('Patient added to the appointment waitlist.');
      onUseRequest?.(body.waitlistEntry);
      await load();
    } catch (requestError) { setError(requestError.message); }
    finally { setSaving(false); }
  };

  const cancel = async (id) => {
    setError(''); setNotice('');
    try {
      const response = await authFetch(`/api/receptionist/waitlist/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel' }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Waitlist request could not be cancelled');
      if (selectedWaitlistId === id) onUseRequest?.(null);
      setNotice('Waitlist request cancelled.'); await load();
    } catch (requestError) { setError(requestError.message); }
  };

  return <section className="rounded-xl border border-amber-100 bg-amber-50/40 p-4" aria-labelledby="receptionist-waitlist-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 id="receptionist-waitlist-title" className="flex items-center gap-2 font-semibold text-amber-950"><Clock3 className="h-4 w-4 text-amber-700"/>Appointment waitlist</h3><p className="mt-1 text-xs text-amber-700">Join when the selected Vaidya has no published slot on this date.</p></div><button type="button" onClick={onRefreshAvailability} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-50"><RefreshCw className="h-3.5 w-3.5"/>Check slots</button></div>
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-2.5 text-xs text-red-800">{error}</p>}{notice && <p role="status" className="mt-3 rounded-lg bg-emerald-50 p-2.5 text-xs text-emerald-800">{notice}</p>}
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-amber-800">{loading ? 'Loading waitlist…' : `${entries.length} waiting request${entries.length === 1 ? '' : 's'} for ${date}`}</p><button type="button" onClick={addToWaitlist} disabled={saving || loading || !patientId || !practitionerId || hasAvailableSlots || Boolean(selectedWaitlistId)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-amber-800 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"><ListPlus className="h-3.5 w-3.5"/>{saving ? 'Adding…' : selectedWaitlistId ? 'Request selected' : 'Add selected patient'}</button></div>
    {entries.length > 0 && <ul className="mt-2 divide-y divide-amber-100">{entries.map((entry) => <li key={entry._id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"><span className="min-w-0"><b className="block truncate text-amber-950">{entry.patient?.name || 'Patient'}</b><span className="text-xs text-amber-700">{entry.practitioner?.name || 'Vaidya'} · {entry.therapyType}</span></span><span className="flex gap-2"><button type="button" onClick={() => { onUseRequest?.(entry); onRefreshAvailability?.(); }} className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-50">Use request</button><button type="button" onClick={() => cancel(entry._id)} aria-label={`Cancel waitlist request for ${entry.patient?.name || 'patient'}`} className="rounded-lg border border-red-200 bg-white p-1.5 text-red-700 hover:bg-red-50"><XCircle className="h-4 w-4"/></button></span></li>)}</ul>}
  </section>;
}
