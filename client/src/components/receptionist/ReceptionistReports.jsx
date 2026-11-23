import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FileBarChart, RefreshCw } from 'lucide-react';
import authFetch from '../../utils/apiClient';

const localDay = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

export default function ReceptionistReports() {
  const [to, setTo] = useState(localDay());
  const [from, setFrom] = useState(() => `${localDay().slice(0, 7)}-01`);
  const [view, setView] = useState('daily');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await authFetch(`/api/receptionist/reports?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Reports could not be loaded');
      setReport(body);
    } catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const chartRows = useMemo(() => {
    if (!report?.daily) return [];
    if (view === 'daily') return report.daily;
    const months = new Map();
    for (const item of report.daily) {
      const month = item._id.slice(0, 7);
      const aggregate = months.get(month) || { _id: month, total: 0, completed: 0, cancelled: 0 };
      aggregate.total += item.total; aggregate.completed += item.completed; aggregate.cancelled += item.cancelled;
      months.set(month, aggregate);
    }
    return [...months.values()];
  }, [report, view]);

  const exportCsv = () => {
    if (!report) return;
    const rows = [
      ['Date', 'Appointments', 'Completed', 'Cancelled'],
      ...report.daily.map((item) => [item._id, item.total, item.completed, item.cancelled]),
    ];
    const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `ayursutra-reception-report-${from}-to-${to}.csv`; link.click(); URL.revokeObjectURL(url);
  };

  const totals = report?.totals || {};
  const maxTotal = Math.max(1, ...chartRows.map((item) => item.total));
  return <section id="receptionist-reports" className="scroll-mt-6 space-y-4 rounded-2xl border border-amber-200 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="receptionist-reports-title">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-700"><FileBarChart className="h-4 w-4"/>Operations analytics</p><h2 id="receptionist-reports-title" className="mt-1 text-xl font-semibold text-amber-950">Reception reports</h2><p className="mt-1 text-sm text-amber-800">Appointment, waiting-time and verified Vaidya workload data from the clinic database.</p></div><button type="button" disabled={!report || loading} onClick={exportCsv} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-amber-300 px-3 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-50 disabled:opacity-50"><Download className="h-4 w-4"/>Export CSV</button></header>
    <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"><label className="text-xs font-medium text-amber-800">From<input type="date" max={to} value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1 block w-full rounded-lg border-amber-200"/></label><label className="text-xs font-medium text-amber-800">Through<input type="date" min={from} value={to} onChange={(event) => setTo(event.target.value)} className="mt-1 block w-full rounded-lg border-amber-200"/></label><button type="button" onClick={load} disabled={loading} className="inline-flex min-h-10 items-center justify-center gap-2 self-end rounded-lg bg-amber-800 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-900 disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}/>Refresh</button></div>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {loading && !report && <div role="status" aria-label="Loading reports" className="grid gap-3 sm:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="h-24 animate-pulse rounded-xl bg-amber-50"/>)}</div>}
    {report && <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[
        ['Appointments', totals.appointments ?? 0], ['Completed', totals.completed ?? 0], ['Cancelled', totals.cancelled ?? 0], ['Missed (unattended past visits)', totals.missed ?? 0], ['Avg. call wait', totals.averageWaitingMinutes == null ? '—' : `${totals.averageWaitingMinutes} min`], ['Therapy sessions', totals.therapySessions ?? 0],
      ].map(([label, value]) => <article key={label} className="rounded-xl border border-amber-100 bg-amber-50/50 p-4"><p className="text-xs text-amber-700">{label}</p><p className="mt-1 text-2xl font-semibold text-amber-950">{value}</p></article>)}</div>
      <section className="rounded-xl border border-amber-100 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold text-amber-950">Visit trends</h3><p className="text-xs text-amber-700">Completed, cancelled and total appointments</p></div><div role="group" aria-label="Report grouping" className="flex rounded-lg border border-amber-200 bg-amber-50 p-1">{[['daily', 'Daily'], ['monthly', 'Monthly']].map(([value, label]) => <button key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${view === value ? 'bg-amber-800 text-white' : 'text-amber-900 hover:bg-white'}`}>{label}</button>)}</div></div>
        {chartRows.length ? <div className="mt-4 space-y-3">{chartRows.map((item) => <div key={item._id} className="grid grid-cols-[5.5rem_minmax(0,1fr)_2.5rem] items-center gap-3 text-xs"><span className="text-amber-800">{item._id}</span><div className="h-3 overflow-hidden rounded-full bg-stone-100"><div className="flex h-full" style={{ width: `${Math.max(2, (item.total / maxTotal) * 100)}%` }}><span className="h-full bg-emerald-600" style={{ width: `${item.total ? item.completed / item.total * 100 : 0}%` }}/><span className="h-full bg-red-400" style={{ width: `${item.total ? item.cancelled / item.total * 100 : 0}%` }}/><span className="h-full flex-1 bg-amber-400"/></div></div><span className="text-right font-medium text-amber-950">{item.total}</span></div>)}</div> : <p className="mt-4 text-sm text-stone-600">No appointment data exists in this date range.</p>}
      </section>
      <section className="overflow-hidden rounded-xl border border-amber-100"><div className="border-b border-amber-100 bg-amber-50/50 p-4"><h3 className="font-semibold text-amber-950">Vaidya utilization</h3><p className="text-xs text-amber-700">Booked appointment minutes divided by published working minutes in the selected period.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[36rem] text-left text-sm"><thead className="text-xs text-amber-700"><tr><th scope="col" className="px-4 py-3">Vaidya</th><th scope="col" className="px-4 py-3">Visits</th><th scope="col" className="px-4 py-3">Booked time</th><th scope="col" className="px-4 py-3">Published time</th><th scope="col" className="px-4 py-3">Utilization</th></tr></thead><tbody className="divide-y divide-amber-100">{report.practitioners.map((person) => <tr key={person.practitionerId}><td className="px-4 py-3 font-medium text-amber-950">{person.name}</td><td className="px-4 py-3">{person.appointments}</td><td className="px-4 py-3">{person.bookedMinutes} min</td><td className="px-4 py-3">{person.availableMinutes} min</td><td className="px-4 py-3">{person.utilizationPercent == null ? 'No published hours' : `${person.utilizationPercent}%`}</td></tr>)}{report.practitioners.length === 0 && <tr><td colSpan="5" className="px-4 py-6 text-center text-stone-600">No Vaidya sessions were scheduled in this range.</td></tr>}</tbody></table></div></section>
      <p className="text-xs text-stone-600">Missed visits are appointments dated before today that remain scheduled or confirmed and have no check-in. Waiting time is measured from check-in to the receptionist call action. Payment reporting is unavailable because this project has no billing or payment model.</p>
    </>}
  </section>;
}
