import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import { jsPDF } from 'jspdf';
import { Activity, BarChart3, CalendarDays, Download, FileText, Users } from 'lucide-react';
import { ArcElement, BarElement, CategoryScale, Chart as ChartJS, Filler, Legend, LinearScale, LineElement, PointElement, Tooltip } from 'chart.js';
import authFetch from '../../utils/apiClient';

ChartJS.register(ArcElement, BarElement, CategoryScale, Filler, Legend, LinearScale, LineElement, PointElement, Tooltip);

const tabs = [
  ['overview', 'Overview'], ['appointments', 'Appointments'], ['patients', 'Patients'],
  ['practitioners', 'Practitioners'], ['therapies', 'Therapies'], ['progress', 'Treatment Progress'], ['exports', 'Exports'],
];
const api = '/api/admin/reports';
const todayString = () => new Date().toISOString().slice(0, 10);
const daysBefore = (days) => { const date = new Date(); date.setDate(date.getDate() - days); return date.toISOString().slice(0, 10); };
const printValue = (value) => value == null || value === '' ? '—' : value instanceof Date ? value.toLocaleString() : typeof value === 'object' ? JSON.stringify(value) : String(value);

async function responseBody(response, message) { let body; try { body = await response.json(); } catch { body = {}; } if (!response.ok) throw new Error(body.message || message); return body; }

function ChartCard({ title, data, type = 'line', options = {} }) {
  const values = (data?.datasets || []).flatMap((dataset) => dataset.data || []);
  const populated = values.some((value) => Number(value) > 0);
  const Chart = type === 'bar' ? Bar : type === 'doughnut' ? Doughnut : Line;
  return <section className="rounded-xl border border-amber-100 bg-white p-4"><h3 className="mb-3 font-semibold text-amber-950">{title}</h3>{populated ? <div className="relative h-64"><Chart data={data} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: type === 'doughnut' ? 'bottom' : 'top' } }, ...options }} /></div> : <div className="flex h-64 items-center justify-center rounded-lg bg-amber-50 px-4 text-center text-sm text-gray-600">Not enough recorded data to show this chart.</div>}</section>;
}

function MetricCard({ title, metric, plain = false }) {
  const value = plain ? metric : metric?.current;
  const comparison = metric && !plain ? (metric.previous > 0 ? `${metric.changePercent > 0 ? '+' : ''}${metric.changePercent}% vs prior period` : 'No prior-period baseline') : '';
  return <article className="rounded-xl border border-amber-100 bg-white p-4"><p className="text-sm text-gray-600">{title}</p><strong className="text-2xl text-amber-900">{value ?? '—'}</strong>{comparison && <p className="mt-1 text-xs text-gray-500">{comparison}</p>}</article>;
}

function DataTable({ columns, rows, onRowClick }) {
  if (!rows?.length) return <p className="rounded-lg bg-white p-5 text-center text-sm text-gray-600">No records were found for this report.</p>;
  return <div className="overflow-x-auto rounded-xl border border-amber-100 bg-white"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-amber-50"><tr>{columns.map((column) => <th key={column.key} className="px-3 py-3 font-semibold capitalize">{column.label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={row._id || index} onClick={() => onRowClick?.(row)} className={`border-t border-amber-50 ${onRowClick ? 'cursor-pointer hover:bg-amber-50/60' : ''}`}>{columns.map((column) => <td key={column.key} className="px-3 py-3">{column.render ? column.render(row[column.key], row) : printValue(row[column.key])}</td>)}</tr>)}</tbody></table></div>;
}

function downloadCsv(fileName, report) {
  const cell = (value) => {
    let text = value == null ? '' : value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const rows = [report.columns || [], ...(report.rows || []).map((row) => (report.columns || []).map((column) => row[column]))];
  if (report.patient) rows.unshift([`Patient report: ${report.patient.name} · ${report.patient.email}`]);
  const blob = new Blob([`\uFEFF${rows.map((row) => row.map(cell).join(',')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = fileName; link.click(); URL.revokeObjectURL(url);
}

function downloadPdf(fileName, title, report, range) {
  const document = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = document.internal.pageSize.getWidth(); const pageHeight = document.internal.pageSize.getHeight();
  let y = 18;
  document.setFontSize(18); document.setTextColor(112, 65, 25); document.text('AyurSutra · Reports & Analytics', 14, y); y += 9;
  document.setFontSize(13); document.text(title, 14, y); y += 7;
  document.setFontSize(9); document.setTextColor(90, 80, 65); document.text(`Period: ${range.from} to ${range.to}`, 14, y); y += 8;
  if (report.patient) { document.text(`Patient: ${report.patient.name} · ${report.patient.email}`, 14, y); y += 7; }
  const headers = report.columns || [];
  const colWidth = Math.max(25, Math.min(68, (pageWidth - 28) / Math.max(headers.length, 1)));
  const drawRow = (values, bold = false) => {
    const chunks = values.map((value) => document.splitTextToSize(printValue(value), colWidth - 3));
    const rowHeight = Math.max(7, ...chunks.map((lines) => lines.length * 4 + 2));
    if (y + rowHeight > pageHeight - 12) { document.addPage(); y = 15; }
    if (bold) { document.setFillColor(253, 247, 233); document.rect(12, y - 4, pageWidth - 24, rowHeight, 'F'); }
    document.setFont(undefined, bold ? 'bold' : 'normal'); document.setFontSize(8); document.setTextColor(60, 48, 38);
    chunks.forEach((lines, index) => document.text(lines, 14 + index * colWidth, y)); y += rowHeight;
  };
  drawRow(headers.map((header) => header.replaceAll(/([A-Z])/g, ' $1')), true);
  (report.rows || []).forEach((row) => drawRow(headers.map((header) => row[header])));
  document.save(fileName);
}

export default function AdminReports() {
  const [activeTab, setActiveTab] = useState('overview');
  const [from, setFrom] = useState(daysBefore(29)); const [to, setTo] = useState(todayString()); const [preset, setPreset] = useState('30');
  const [analytics, setAnalytics] = useState(null); const [rows, setRows] = useState([]); const [columns, setColumns] = useState([]); const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [query, setQuery] = useState(''); const [accountStatus, setAccountStatus] = useState('all'); const [planStatus, setPlanStatus] = useState('all');
  const [appointmentStatus, setAppointmentStatus] = useState('all'); const [therapyFilter, setTherapyFilter] = useState('all'); const [practitionerFilter, setPractitionerFilter] = useState('all');
  const [practitioners, setPractitioners] = useState([]); const [therapyOptions, setTherapyOptions] = useState([]); const [exportType, setExportType] = useState('sessions'); const [exportPatientId, setExportPatientId] = useState(''); const [patientOptions, setPatientOptions] = useState([]); const [exportBusy, setExportBusy] = useState(false); const [exportMessage, setExportMessage] = useState('');

  const rangeParams = useMemo(() => new URLSearchParams({ from, to }), [from, to]);
  const load = useCallback(async () => {
    if (!from || !to || from > to) { setError('Choose a valid date range.'); return; }
    setLoading(true); setError(''); setDetail(null);
    try {
      const baseParams = new URLSearchParams(rangeParams);
      if (activeTab === 'appointments') {
        baseParams.set('status', appointmentStatus); baseParams.set('therapy', therapyFilter); if (practitionerFilter !== 'all') baseParams.set('practitionerId', practitionerFilter);
        const [report, exportReport, practitionerData, therapyData] = await Promise.all([
          responseBody(await authFetch(`${api}/analytics?${baseParams}`), 'Analytics could not be loaded'),
          responseBody(await authFetch(`${api}/export?type=sessions&${baseParams}`), 'Appointment rows could not be loaded'),
          responseBody(await authFetch(`${api}/practitioners?${rangeParams}`), 'Practitioner filters could not be loaded'),
          responseBody(await authFetch(`${api}/therapies?${rangeParams}`), 'Therapy filters could not be loaded'),
        ]);
        setAnalytics(report); setRows(exportReport.rows || []); setColumns(exportReport.columns || []); setPractitioners(practitionerData.practitioners || []); setTherapyOptions(therapyData.therapies || []);
      } else if (activeTab === 'patients' || activeTab === 'exports') {
        const [patientData, practitionerData] = await Promise.all([
          responseBody(await authFetch(`${api}/patients?${rangeParams}&q=${encodeURIComponent(query)}&accountStatus=${activeTab === 'patients' ? accountStatus : 'all'}`), 'Patient reports could not be loaded'),
          responseBody(await authFetch(`${api}/practitioners?${rangeParams}`), 'Practitioner list could not be loaded'),
        ]);
        setRows(patientData.patients || []); setPractitioners(practitionerData.practitioners || []); setPatientOptions(patientData.patients || []);
      } else if (activeTab === 'practitioners') {
        const body = await responseBody(await authFetch(`${api}/practitioners?${rangeParams}&q=${encodeURIComponent(query)}`), 'Practitioner reports could not be loaded'); setRows(body.practitioners || []);
      } else if (activeTab === 'therapies') {
        const body = await responseBody(await authFetch(`${api}/therapies?${rangeParams}`), 'Therapy analytics could not be loaded'); setRows(body.therapies || []);
      } else if (activeTab === 'progress') {
        const [report, plans] = await Promise.all([
          responseBody(await authFetch(`${api}/analytics?${rangeParams}`), 'Treatment metrics could not be loaded'),
          responseBody(await authFetch(`${api}/plans?${rangeParams}&status=${planStatus}`), 'Plan reports could not be loaded'),
        ]); setAnalytics(report); setRows(plans.plans || []);
      } else {
        const body = await responseBody(await authFetch(`${api}/analytics?${rangeParams}`), 'Analytics could not be loaded'); setAnalytics(body);
      }
    } catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }, [from, to, rangeParams, activeTab, appointmentStatus, therapyFilter, practitionerFilter, accountStatus, query, planStatus]);

  useEffect(() => { load(); }, [load]);

  const choosePreset = (value) => {
    setPreset(value);
    if (value === 'custom') return;
    if (value === 'today') { setFrom(todayString()); setTo(todayString()); return; }
    const length = Number(value); setFrom(daysBefore(length - 1)); setTo(todayString());
  };
  const openPatient = async (patient) => {
    setLoading(true); setError(''); try { const body = await responseBody(await authFetch(`${api}/patients/${patient._id}`), 'Patient report could not be loaded'); setDetail({ type: 'patient', data: body }); } catch (e) { setError(e.message); } finally { setLoading(false); }
  };
  const openPractitioner = async (practitioner) => {
    setLoading(true); setError(''); try { const params = new URLSearchParams(rangeParams); const body = await responseBody(await authFetch(`${api}/practitioners/${practitioner._id}?${params}`), 'Practitioner report could not be loaded'); setDetail({ type: 'practitioner', data: body }); } catch (e) { setError(e.message); } finally { setLoading(false); }
  };

  const exportReport = async (format) => {
    if (exportType === 'patient-report' && !exportPatientId) { setExportMessage('Select a patient before exporting an individual report.'); return; }
    setExportBusy(true); setExportMessage('');
    try {
      const params = new URLSearchParams(rangeParams); params.set('type', exportType); if (exportType === 'patient-report') params.set('patientId', exportPatientId);
      const report = await responseBody(await authFetch(`${api}/export?${params}`), 'Report export failed');
      const suffix = `${from}-to-${to}`; const label = exportType.replaceAll('-', '_');
      if (format === 'csv') downloadCsv(`ayursutra-${label}-${suffix}.csv`, report);
      else downloadPdf(`ayursutra-${label}-${suffix}.pdf`, `${label.replaceAll('_', ' ')} report`, report, { from, to });
      setExportMessage(`${format.toUpperCase()} report downloaded using records from ${from} through ${to}.`);
    } catch (e) { setExportMessage(e.message); }
    finally { setExportBusy(false); }
  };

  const filterOptions = useMemo(() => [...new Set(therapyOptions.map((item) => item.name).filter(Boolean))], [therapyOptions]);
  const appointmentChart = (key) => ({ labels: (analytics?.trends?.appointments || []).map((item) => item.date), datasets: [
    { label: 'Total appointments', data: (analytics?.trends?.appointments || []).map((item) => item.total), borderColor: '#C46A22', backgroundColor: 'rgba(196,106,34,.12)', fill: true, tension: .25 },
    { label: 'Completed', data: (analytics?.trends?.appointments || []).map((item) => item.completed), borderColor: '#62834A', backgroundColor: 'rgba(98,131,74,.12)', tension: .25 },
    { label: 'Cancelled', data: (analytics?.trends?.appointments || []).map((item) => item.cancelled), borderColor: '#A84B42', backgroundColor: 'rgba(168,75,66,.1)', tension: .25 },
  ] });
  const patientChart = { labels: (analytics?.trends?.patientRegistrations || []).map((item) => item.date), datasets: [{ label: 'New patients', data: (analytics?.trends?.patientRegistrations || []).map((item) => item.registrations), borderColor: '#9D5B25', backgroundColor: 'rgba(157,91,37,.15)', fill: true, tension: .25 }] };
  const statusChart = { labels: Object.keys(analytics?.statusDistribution || {}), datasets: [{ data: Object.values(analytics?.statusDistribution || {}), backgroundColor: ['#C46A22','#D9A441','#60865A','#68879B','#A84B42'] }] };
  const therapyChart = { labels: (analytics?.therapyAnalytics || []).slice(0, 10).map((item) => item.therapy), datasets: [{ label: 'Sessions', data: (analytics?.therapyAnalytics || []).slice(0, 10).map((item) => item.sessions), backgroundColor: '#C97732' }] };
  const workloadChart = { labels: (analytics?.practitionerWorkload || []).map((item) => item.practitioner?.name || 'Unknown'), datasets: [{ label: 'Completed', data: (analytics?.practitionerWorkload || []).map((item) => item.completedSessions), backgroundColor: '#77905E' }, { label: 'Upcoming', data: (analytics?.practitionerWorkload || []).map((item) => item.upcomingSessions), backgroundColor: '#D99A48' }] };
  const planChart = { labels: Object.keys(analytics?.metrics?.plansByStatus || {}), datasets: [{ data: Object.values(analytics?.metrics?.plansByStatus || {}), backgroundColor: ['#D9A441','#C46A22','#678B58','#A84B42'] }] };

  return <main className="space-y-5 rounded-2xl border border-amber-100 bg-[#FDF7E9] p-4 text-amber-950 sm:p-6">
    <header className="flex flex-col justify-between gap-3 md:flex-row md:items-center"><div><h2 className="text-2xl font-semibold">Reports &amp; Analytics</h2><p className="text-sm text-gray-600">Operational reports based on saved clinic records. Restricted to administrators.</p></div><div className="flex items-center gap-2 text-sm text-amber-800"><BarChart3 className="h-5 w-5"/>Range up to 2 years</div></header>
    <section className="rounded-xl border border-amber-200 bg-white p-3"><div className="flex flex-wrap gap-2">{[['today','Today'],['7','Last 7 days'],['30','Last 30 days'],['90','Last 90 days'],['custom','Custom range']].map(([value,label]) => <button key={value} onClick={() => choosePreset(value)} className={`rounded-lg px-3 py-2 text-sm ${preset === value ? 'bg-amber-700 text-white' : 'border border-amber-200 text-amber-900'}`}>{label}</button>)}
      {preset === 'custom' && <><label className="ml-auto text-xs text-gray-600">From<input type="date" value={from} onChange={(e) => { setPreset('custom'); setFrom(e.target.value); }} className="ml-2 rounded border border-amber-200 p-2 text-sm"/></label><label className="text-xs text-gray-600">To<input type="date" value={to} onChange={(e) => { setPreset('custom'); setTo(e.target.value); }} className="ml-2 rounded border border-amber-200 p-2 text-sm"/></label></>}</div></section>
    <nav className="flex flex-wrap gap-2">{tabs.map(([id,label]) => <button key={id} onClick={() => { setActiveTab(id); setDetail(null); }} className={`rounded-lg px-3 py-2 text-sm font-medium ${activeTab === id ? 'bg-amber-700 text-white' : 'border border-amber-200 bg-white text-amber-900'}`}>{label}</button>)}</nav>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">{error}</p>}
    {activeTab === 'appointments' && <section className="grid gap-2 rounded-xl border border-amber-100 bg-white p-3 md:grid-cols-4"><label className="text-xs">Status<select value={appointmentStatus} onChange={(e) => setAppointmentStatus(e.target.value)} className="mt-1 block w-full rounded border p-2 text-sm">{['all','scheduled','confirmed','in-progress','completed','cancelled'].map((item) => <option key={item}>{item}</option>)}</select></label><label className="text-xs">Therapy<select value={therapyFilter} onChange={(e) => setTherapyFilter(e.target.value)} className="mt-1 block w-full rounded border p-2 text-sm"><option value="all">All therapies</option>{filterOptions.map((item) => <option key={item}>{item}</option>)}</select></label><label className="text-xs">Practitioner<select value={practitionerFilter} onChange={(e) => setPractitionerFilter(e.target.value)} className="mt-1 block w-full rounded border p-2 text-sm"><option value="all">All practitioners</option>{practitioners.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select></label><button onClick={load} className="self-end rounded bg-amber-700 px-4 py-2 text-sm text-white">Apply filters</button></section>}
    {(activeTab === 'patients' || activeTab === 'practitioners') && <section className="grid gap-2 rounded-xl border border-amber-100 bg-white p-3 sm:grid-cols-[1fr_auto_auto]"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, email or phone" className="rounded border border-amber-200 p-2"/>{activeTab === 'patients' && <select value={accountStatus} onChange={(e) => setAccountStatus(e.target.value)} className="rounded border border-amber-200 p-2"><option value="all">All account statuses</option><option value="active">Active</option><option value="inactive">Suspended</option></select>}<button onClick={load} className="rounded bg-amber-700 px-4 py-2 text-sm text-white">Search</button></section>}
    {activeTab === 'progress' && <select value={planStatus} onChange={(e) => setPlanStatus(e.target.value)} className="rounded border border-amber-200 bg-white p-2">{['all','draft','pending-approval','approved','rejected'].map((item) => <option key={item}>{item}</option>)}</select>}
    {loading ? <p role="status" className="rounded-xl bg-white p-8 text-center">Loading report data…</p> : activeTab === 'overview' ? analytics && <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard title="Total registered patients" metric={analytics.metrics.totalPatients} plain/><MetricCard title="New patients" metric={analytics.metrics.newPatients}/><MetricCard title="Active practitioners" metric={analytics.metrics.activePractitioners} plain/><MetricCard title="Therapy sessions" metric={analytics.metrics.totalSessions}/><MetricCard title="Completed sessions" metric={analytics.metrics.completedSessions}/><MetricCard title="Cancelled sessions" metric={analytics.metrics.cancelledSessions}/><MetricCard title="Upcoming sessions" metric={analytics.metrics.upcomingSessions} plain/><MetricCard title="Approved treatment plans" metric={analytics.metrics.plansByStatus.approved || 0} plain/><MetricCard title="Pending plan approvals" metric={analytics.metrics.plansByStatus['pending-approval'] || 0} plain/><MetricCard title="Pending follow-ups" metric={analytics.metrics.followUpsByStatus.pending || 0} plain/><MetricCard title="Completed follow-ups" metric={analytics.metrics.followUpsByStatus.completed || 0} plain/><MetricCard title="Reschedules" metric={analytics.rescheduleCount} plain/></div>
      <div className="grid gap-4 xl:grid-cols-2"><ChartCard title="Appointments over time" data={appointmentChart()}/><ChartCard title="Patient registrations" data={patientChart}/><ChartCard title="Session status distribution" data={statusChart} type="doughnut"/><ChartCard title="Therapy utilization" data={therapyChart} type="bar"/><ChartCard title="Practitioner workload" data={workloadChart} type="bar"/><ChartCard title="Treatment plan status" data={planChart} type="doughnut"/></div>
      <p className="rounded-lg bg-white p-3 text-sm text-gray-600">Approved planned sessions: {analytics.metrics.plannedSessions} · Generated: {analytics.metrics.generatedSessions} · Completed: {analytics.metrics.completedGeneratedSessions} · Cancelled: {analytics.metrics.cancelledGeneratedSessions} · Remaining planned: {analytics.metrics.remainingPlannedSessions} · Not yet generated: {analytics.metrics.remainingToGenerate}</p>
    </> : activeTab === 'appointments' ? <><div className="grid gap-4 xl:grid-cols-2"><ChartCard title="Appointment volume and outcomes" data={appointmentChart()}/><ChartCard title="Session status" data={statusChart} type="doughnut"/></div><DataTable columns={[
      { key: 'date', label: 'Date', render: (value) => new Date(value).toLocaleDateString() }, { key: 'startTime', label: 'Time' }, { key: 'patientName', label: 'Patient' }, { key: 'practitionerName', label: 'Practitioner' }, { key: 'therapy', label: 'Therapy' }, { key: 'status', label: 'Status' }, { key: 'durationMins', label: 'Planned min' }, { key: 'actualDurationMins', label: 'Actual min' },
    ]} rows={rows}/><p className="text-xs text-gray-500">Reschedule events recorded in session history: {analytics?.rescheduleCount ?? '—'}</p></> : activeTab === 'patients' ? detail?.type === 'patient' ? <PatientDetailReport report={detail.data} onBack={() => setDetail(null)}/> : <DataTable columns={[
      { key: 'name', label: 'Patient' }, { key: 'email', label: 'Email' }, { key: 'accountStatus', label: 'Account' }, { key: 'assignedPractitioner', label: 'Practitioner', render: (v) => v?.name || 'Unassigned' }, { key: 'createdAt', label: 'Registered', render: (v) => new Date(v).toLocaleDateString() }, { key: 'sessionTotals', label: 'Sessions complete / total', render: (v) => `${v.completed} / ${v.total}` }, { key: 'planTotals', label: 'Plans', render: (v) => `${v.approved} approved / ${v.total}` }, { key: 'followUpTotals', label: 'Follow-ups', render: (v) => `${v.pending} pending / ${v.completed} done` },
    ]} rows={rows} onRowClick={openPatient}/> : activeTab === 'practitioners' ? detail?.type === 'practitioner' ? <PractitionerDetailReport report={detail.data} onBack={() => setDetail(null)}/> : <DataTable columns={[
      { key: 'name', label: 'Practitioner' }, { key: 'email', label: 'Email' }, { key: 'professionalStatus', label: 'Status', render: (v) => v || 'active' }, { key: 'assignedPatientCount', label: 'Patients' }, { key: 'totalSessions', label: 'Sessions' }, { key: 'completedSessions', label: 'Completed' }, { key: 'cancelledSessions', label: 'Cancelled' }, { key: 'upcomingSessions', label: 'Upcoming' },
    ]} rows={rows} onRowClick={openPractitioner}/> : activeTab === 'therapies' ? <DataTable columns={[
      { key: 'name', label: 'Therapy' }, { key: 'category', label: 'Category' }, { key: 'active', label: 'Catalogue status', render: (v) => v == null ? 'Legacy' : v ? 'Active' : 'Inactive' }, { key: 'sessions', label: 'Sessions' }, { key: 'completed', label: 'Completed' }, { key: 'planned', label: 'Planned' }, { key: 'averageActualDurationMins', label: 'Avg actual minutes', render: (v) => v == null ? 'Not recorded' : v },
    ]} rows={rows}/> : activeTab === 'progress' ? <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><MetricCard title="Approved planned sessions" metric={analytics?.metrics.plannedSessions} plain/><MetricCard title="Generated sessions" metric={analytics?.metrics.generatedSessions} plain/><MetricCard title="Completed generated" metric={analytics?.metrics.completedGeneratedSessions} plain/><MetricCard title="Cancelled generated" metric={analytics?.metrics.cancelledGeneratedSessions} plain/><MetricCard title="Remaining planned" metric={analytics?.metrics.remainingPlannedSessions} plain/><MetricCard title="Not yet generated" metric={analytics?.metrics.remainingToGenerate} plain/></div><ChartCard title="Plan status distribution" data={planChart} type="doughnut"/><DataTable columns={[
      { key: 'patient', label: 'Patient', render: (v) => v?.name || '—' }, { key: 'doctor', label: 'Practitioner', render: (v) => v?.name || '—' }, { key: 'status', label: 'Status' }, { key: 'assessment', label: 'Assessment date', render: (v) => v?.assessedAt ? new Date(v.assessedAt).toLocaleDateString() : '—' }, { key: 'startDate', label: 'Plan start', render: (v) => new Date(v).toLocaleDateString() }, { key: 'therapies', label: 'Therapies', render: (v) => v.map((item) => `${item.therapyType} (${item.occurrences})`).join(', ') }, { key: 'plannedSessionCount', label: 'Planned' }, { key: 'generatedSessionCount', label: 'Generated' }, { key: 'completedSessionCount', label: 'Completed' }, { key: 'cancelledSessionCount', label: 'Cancelled' }, { key: 'remainingPlannedSessionCount', label: 'Remaining care' }, { key: 'remainingToGenerate', label: 'Not generated' },
    ]} rows={rows}/></> : activeTab === 'exports' ? <section className="space-y-4 rounded-xl border border-amber-200 bg-white p-5"><h3 className="text-lg font-semibold">Download reports</h3><p className="text-sm text-gray-600">Exports use the selected range. Sensitive patient report details are available only in the admin area.</p><div className="grid gap-3 md:grid-cols-2"><label className="text-sm">Report type<select value={exportType} onChange={(e) => setExportType(e.target.value)} className="mt-1 block w-full rounded border border-amber-200 p-2">{[['sessions','Appointments / sessions'],['patients','Patient directory and progress summary'],['patient-report','Individual patient report'],['practitioners','Practitioner workload'],['plans','Treatment plans'],['therapies','Therapy utilization'],['follow-ups','Follow-up report'],['feedback','Session feedback']].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>{exportType === 'patient-report' && <label className="text-sm">Patient<select value={exportPatientId} onChange={(e) => setExportPatientId(e.target.value)} className="mt-1 block w-full rounded border border-amber-200 p-2"><option value="">Select patient</option>{patientOptions.map((patient) => <option key={patient._id} value={patient._id}>{patient.name} · {patient.email}</option>)}</select></label>}</div><div className="flex flex-wrap gap-2"><button disabled={exportBusy} onClick={() => exportReport('csv')} className="inline-flex items-center gap-2 rounded-lg bg-amber-700 px-4 py-2 text-white disabled:opacity-50"><Download className="h-4 w-4"/>{exportBusy ? 'Preparing…' : 'Download CSV'}</button><button disabled={exportBusy} onClick={() => exportReport('pdf')} className="inline-flex items-center gap-2 rounded-lg border border-amber-400 px-4 py-2 disabled:opacity-50"><FileText className="h-4 w-4"/>Download PDF</button></div>{exportMessage && <p role="status" className="rounded bg-amber-50 p-3 text-sm">{exportMessage}</p>}</section> : null}
    {activeTab !== 'exports' && loading === false && (activeTab === 'overview' || activeTab === 'appointments' || activeTab === 'progress') && null}
    <footer className="flex items-center justify-between border-t border-amber-200 pt-3 text-xs text-gray-500"><span><CalendarDays className="mr-1 inline h-3.5 w-3.5"/>{from} through {to}</span><span><Activity className="mr-1 inline h-3.5 w-3.5"/>Records only · no modeled clinical outcome scores</span></footer>
  </main>;
}

function PatientDetailReport({ report, onBack }) {
  const p = report.patient;
  return <section className="space-y-4 rounded-xl border border-amber-200 bg-white p-5"><button onClick={onBack} className="rounded border px-3 py-1.5 text-sm">Back to patient list</button><header><h3 className="text-xl font-semibold">{p.name}</h3><p className="text-sm text-gray-600">{p.email} · {p.phone || 'No phone'} · Registered {new Date(p.createdAt).toLocaleDateString()} · Account {p.accountStatus}</p><p className="text-sm">Assigned practitioner: {p.assignedPractitioner?.name || 'Unassigned'}</p></header><div className="grid gap-4 xl:grid-cols-2"><ReportList title="Assessment history" items={report.assessments} empty="No assessments recorded." render={(item) => `${new Date(item.assessedAt).toLocaleDateString()} · ${item.diagnosis || 'Assessment recorded'} · ${item.doctor?.name || 'Clinician'}`}/><ReportList title="Treatment plans" items={report.plans} empty="No treatment plans recorded." render={(item) => `${item.status} · ${new Date(item.startDate).toLocaleDateString()} · ${item.therapies.map((therapy) => `${therapy.therapyType} (${therapy.occurrences})`).join(', ')}`}/><ReportList title="Therapy session history" items={report.sessions} empty="No sessions recorded." render={(item) => `${new Date(item.date).toLocaleDateString()} ${item.startTime} · ${item.therapySnapshot?.name || item.therapyType} · ${item.status}${item.feedback?.submittedAt ? ` · feedback ${item.feedback.wellness}/5` : ''}`}/><ReportList title="Follow-up history" items={report.followUps} empty="No follow-ups recorded." render={(item) => `${new Date(item.dueAt).toLocaleDateString()} · ${item.status} · ${item.practitioner?.name || 'Practitioner'}`}/></div></section>;
}

function PractitionerDetailReport({ report, onBack }) {
  const p = report.practitioner;
  return <section className="space-y-4 rounded-xl border border-amber-200 bg-white p-5"><button onClick={onBack} className="rounded border px-3 py-1.5 text-sm">Back to practitioner list</button><header className="flex items-center gap-3">{p.profileImageUrl && <img src={p.profileImageUrl} alt="" className="h-16 w-16 rounded-full object-cover"/>}<div><h3 className="text-xl font-semibold">{p.name}</h3><p className="text-sm text-gray-600">{p.email} · {p.phone || 'No phone'} · {p.experience || 0} years · {p.professionalStatus || 'active'}</p><p className="text-sm">{(p.qualifications || []).join(', ')} · Skills: {(p.practiceAreas || []).join(', ')}</p></div></header><div className="grid gap-4 md:grid-cols-2"><ReportList title={`Assigned patients (${report.patients.length})`} items={report.patients} empty="No assigned patients." render={(item) => `${item.name} · ${item.email} · ${item.accountStatus || 'active'}`}/><ReportList title="Session schedule" items={report.sessions} empty="No sessions in this date range." render={(item) => `${new Date(item.date).toLocaleDateString()} ${item.startTime} · ${item.patient?.name || 'Open slot'} · ${item.therapyType} · ${item.status}`}/></div><div className="rounded-lg bg-amber-50 p-4"><h4 className="font-semibold">Availability</h4>{p.availabilitySchedule?.filter((day) => day.isAvailable).length ? p.availabilitySchedule.filter((day) => day.isAvailable).map((day) => <p key={day.dayOfWeek} className="text-sm">{day.dayOfWeek} · {day.startTime}–{day.endTime}</p>) : <p className="text-sm text-gray-600">No weekly availability recorded.</p>}</div></section>;
}

function ReportList({ title, items, empty, render }) {
  return <section className="rounded-lg bg-amber-50 p-4"><h4 className="mb-2 font-semibold">{title}</h4>{items?.length ? <div className="max-h-80 space-y-2 overflow-y-auto">{items.map((item, index) => <p key={item._id || index} className="border-b border-amber-100 pb-2 text-sm">{render(item)}</p>)}</div> : <p className="text-sm text-gray-600">{empty}</p>}</section>;
}
