import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, Check, MapPin, Search, UserRound, X } from 'lucide-react';
import authFetch from '../../utils/apiClient';

const shell = 'rounded-2xl border border-amber-200/80 bg-white shadow-sm';
const field = 'min-h-10 w-full rounded-xl border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none focus:border-amber-700 focus:ring-2 focus:ring-amber-700/15';
const isConsultationSession = (session) => !session.treatmentPlan && (['Clinic Appointment', 'General Slot', 'Consultation Slot'].includes(session.sessionName) || ['Custom', 'Consultation', 'General Consultation'].includes(session.therapyType));
const dateKey = (value) => value ? new Date(value).toISOString().slice(0, 10) : '';
const clinicToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const dateFromKey = (value) => { const [year, month, day] = value.split('-').map(Number); return new Date(year, month - 1, day, 12); };
const formatDate = (value, options = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) => {
  const key = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : dateKey(value);
  return key ? new Intl.DateTimeFormat('en-IN', options).format(dateFromKey(key)) : 'Date not listed';
};
const statusStyle = { scheduled: 'bg-blue-50 text-blue-800 border-blue-200', confirmed: 'bg-emerald-50 text-emerald-800 border-emerald-200', 'in-progress': 'bg-amber-100 text-amber-900 border-amber-300', completed: 'bg-stone-100 text-stone-700 border-stone-200', cancelled: 'bg-red-50 text-red-800 border-red-200' };
const statusLabel = (status) => ({ scheduled: 'Scheduled', confirmed: 'Confirmed', 'in-progress': 'In progress', completed: 'Completed', cancelled: 'Cancelled' }[status] || status || 'Unknown');
const firstDateOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1, 12);

async function readJson(response, fallback) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.msg || body.message || body.error || fallback);
  return body;
}

export default function PatientAppointments() {
  const [appointments, setAppointments] = useState([]);
  const [practitioners, setPractitioners] = useState([]);
  const [appointmentLoading, setAppointmentLoading] = useState(true);
  const [practitionerLoading, setPractitionerLoading] = useState(false);
  const [error, setError] = useState('');
  const [bookingError, setBookingError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState('');
  const [providerQuery, setProviderQuery] = useState('');
  const [selectedPractitioner, setSelectedPractitioner] = useState('');
  const [bookingSlots, setBookingSlots] = useState([]);
  const [bookingSlotsLoading, setBookingSlotsLoading] = useState(false);
  const [bookingSlot, setBookingSlot] = useState(null);
  const [visitReason, setVisitReason] = useState('');
  const [selectedAppointmentId, setSelectedAppointmentId] = useState('');
  const [activeCategory, setActiveCategory] = useState('upcoming');
  const [calendarMode, setCalendarMode] = useState('month');
  const [calendarCursor, setCalendarCursor] = useState(firstDateOfMonth(new Date()));
  const [calendarDay, setCalendarDay] = useState(clinicToday());
  const [filters, setFilters] = useState({ from: '', to: '', practitioner: '', type: '', status: '', search: '' });
  const [historyPage, setHistoryPage] = useState(1);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [rescheduleTarget, setRescheduleTarget] = useState(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleSlots, setRescheduleSlots] = useState([]);
  const [rescheduleSlot, setRescheduleSlot] = useState(null);
  const [rescheduleLoading, setRescheduleLoading] = useState(false);
  const [rescheduleError, setRescheduleError] = useState('');
  const [reviewReschedule, setReviewReschedule] = useState(false);
  const rescheduleRequestRef = useRef(0);

  const loadAppointments = useCallback(async () => {
    const response = await authFetch('/sessions');
    const body = await readJson(response, 'Unable to load your appointments.');
    const rows = Array.isArray(body) ? body : body.sessions || [];
    setAppointments(rows.filter(isConsultationSession));
  }, []);

  useEffect(() => {
    let active = true;
    setAppointmentLoading(true); setError('');
    authFetch('/sessions').then((response) => readJson(response, 'Unable to load your appointments.'))
      .then((body) => { if (active) { const rows = Array.isArray(body) ? body : body.sessions || []; setAppointments(rows.filter(isConsultationSession)); } })
      .catch((failure) => { if (active) setError(failure.message); })
      .finally(() => { if (active) setAppointmentLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setPractitionerLoading(true);
      const params = new URLSearchParams({ page: '1', pageSize: '12' });
      if (providerQuery.trim()) params.set('q', providerQuery.trim());
      try {
        const body = await readJson(await authFetch(`/api/practitioner-search/search?${params}`), 'Unable to load Vaidyas.');
        if (active) setPractitioners(body.practitioners || []);
      } catch (failure) { if (active) setBookingError(failure.message); }
      finally { if (active) setPractitionerLoading(false); }
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [providerQuery]);

  useEffect(() => {
    let active = true;
    setBookingSlots([]); setBookingSlot(null); setBookingError('');
    if (!selectedPractitioner) return () => { active = false; };
    setBookingSlotsLoading(true);
    authFetch(`/therapy/available?practitionerId=${encodeURIComponent(selectedPractitioner)}`)
      .then((response) => readJson(response, 'Unable to load consultation slots.'))
      .then((body) => { if (active) setBookingSlots((Array.isArray(body) ? body : []).filter(isConsultationSession)); })
      .catch((failure) => { if (active) setBookingError(failure.message); })
      .finally(() => { if (active) setBookingSlotsLoading(false); });
    return () => { active = false; };
  }, [selectedPractitioner]);

  const today = clinicToday();
  const summary = useMemo(() => {
    const isUpcoming = (item) => ['scheduled', 'confirmed'].includes(item.status) && dateKey(item.date) >= today;
    return [
      { id: 'upcoming', label: 'Upcoming', count: appointments.filter(isUpcoming).length, tone: 'text-blue-800', hint: 'Scheduled and confirmed' },
      { id: 'today', label: 'Today', count: appointments.filter((item) => dateKey(item.date) === today && item.status !== 'cancelled').length, tone: 'text-amber-800', hint: formatDate(today, { weekday: 'long', day: 'numeric', month: 'short' }) },
      { id: 'completed', label: 'Completed', count: appointments.filter((item) => item.status === 'completed').length, tone: 'text-stone-700', hint: 'Past consultations' },
      { id: 'cancelled', label: 'Cancelled', count: appointments.filter((item) => item.status === 'cancelled').length, tone: 'text-red-800', hint: 'Cancelled bookings' },
      { id: 'rescheduled', label: 'Rescheduled', count: appointments.filter((item) => item.scheduleHistory?.length > 0).length, tone: 'text-violet-800', hint: 'Appointments with schedule history' },
      { id: 'missed', label: 'Missed', count: appointments.filter((item) => ['scheduled', 'confirmed'].includes(item.status) && dateKey(item.date) < today && !item.checkedInAt).length, tone: 'text-orange-800', hint: 'Past and not checked in' },
    ];
  }, [appointments, today]);

  const practitionersInHistory = useMemo(() => {
    const unique = new Map();
    appointments.forEach((item) => { const id = item.practitioner?._id; if (id) unique.set(id, item.practitioner.name); });
    return [...unique.entries()].map(([id, name]) => ({ id, name }));
  }, [appointments]);

  const filteredAppointments = useMemo(() => {
    const byCategory = appointments.filter((item) => {
      if (activeCategory === 'upcoming') return ['scheduled', 'confirmed'].includes(item.status) && dateKey(item.date) >= today;
      if (activeCategory === 'today') return dateKey(item.date) === today && item.status !== 'cancelled';
      if (activeCategory === 'completed') return item.status === 'completed';
      if (activeCategory === 'cancelled') return item.status === 'cancelled';
      if (activeCategory === 'rescheduled') return item.scheduleHistory?.length > 0;
      if (activeCategory === 'missed') return ['scheduled', 'confirmed'].includes(item.status) && dateKey(item.date) < today && !item.checkedInAt;
      return true;
    });
    const term = filters.search.trim().toLowerCase();
    return byCategory.filter((item) => {
      const key = dateKey(item.date);
      if (filters.from && key < filters.from) return false;
      if (filters.to && key > filters.to) return false;
      if (filters.practitioner && String(item.practitioner?._id || '') !== filters.practitioner) return false;
      if (filters.type && !`${item.sessionName} ${item.therapyType}`.toLowerCase().includes(filters.type.toLowerCase())) return false;
      if (filters.status && item.status !== filters.status) return false;
      if (term && !`${item.practitioner?.name || ''} ${item.sessionName || ''} ${item.therapyType || ''} ${item._id}`.toLowerCase().includes(term)) return false;
      return true;
    }).sort((a, b) => dateKey(b.date).localeCompare(dateKey(a.date)) || String(b.startTime).localeCompare(String(a.startTime)));
  }, [appointments, activeCategory, filters, today]);

  const pageSize = 8;
  const totalPages = Math.max(1, Math.ceil(filteredAppointments.length / pageSize));
  const visibleAppointments = filteredAppointments.slice((historyPage - 1) * pageSize, historyPage * pageSize);
  const selectedAppointment = appointments.find((item) => item._id === selectedAppointmentId);
  const calendarAppointments = appointments.filter((item) => {
    const key = dateKey(item.date);
    if (calendarMode === 'day') return key === calendarDay;
    if (calendarMode === 'week') {
      const start = dateFromKey(calendarDay); start.setDate(start.getDate() - start.getDay());
      const end = new Date(start); end.setDate(end.getDate() + 7);
      return key >= dateKey(start) && key < dateKey(end);
    }
    return key.startsWith(`${calendarCursor.getFullYear()}-${String(calendarCursor.getMonth() + 1).padStart(2, '0')}`);
  });
  const selectedDayAppointments = appointments.filter((item) => dateKey(item.date) === calendarDay).sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));

  useEffect(() => setHistoryPage(1), [activeCategory, filters]);

  const selectDate = (key) => { setCalendarDay(key); setCalendarCursor(dateFromKey(key)); setSelectedAppointmentId(''); };
  const moveCalendar = (direction) => {
    const next = new Date(calendarCursor);
    if (calendarMode === 'month') { next.setDate(1); next.setMonth(next.getMonth() + direction); }
    else if (calendarMode === 'week') next.setDate(next.getDate() + direction * 7);
    else next.setDate(next.getDate() + direction);
    setCalendarCursor(next); setCalendarDay(dateKey(next));
  };

  const book = async (slot) => {
    if (!slot || saving) return;
    setSaving(slot._id); setError(''); setBookingError(''); setNotice('');
    try {
      const response = await authFetch(`/therapy/book/${slot._id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: visitReason.trim() }) });
      const body = await readJson(response, 'Booking could not be completed.');
      setNotice('Consultation booked. It has been added to your appointments.');
      setVisitReason(''); setBookingSlot(null); await loadAppointments();
      if (body.session?._id) setSelectedAppointmentId(body.session._id);
    } catch (failure) { setBookingError(failure.message); if (failure.message.toLowerCase().includes('slot')) { const fresh = await authFetch(`/therapy/available?practitionerId=${encodeURIComponent(selectedPractitioner)}`).then((response) => readJson(response, 'Unable to refresh availability.')).catch(() => []); setBookingSlots((Array.isArray(fresh) ? fresh : []).filter(isConsultationSession)); } }
    finally { setSaving(''); }
  };

  const openReschedule = (appointment) => {
    const next = appointment.date ? dateKey(appointment.date) : today;
    setRescheduleTarget(appointment); setRescheduleDate(next < today ? today : next);
    setRescheduleSlots([]); setRescheduleSlot(null); setReviewReschedule(false); setRescheduleError('');
  };

  const loadRescheduleSlots = useCallback(async (appointment, requestedDate) => {
    if (!appointment?.practitioner?._id || !requestedDate) return;
    const requestId = ++rescheduleRequestRef.current;
    setRescheduleLoading(true); setRescheduleError(''); setRescheduleSlots([]); setRescheduleSlot(null); setReviewReschedule(false);
    try {
      const params = new URLSearchParams({ practitionerId: appointment.practitioner._id, date: requestedDate });
      const body = await readJson(await authFetch(`/therapy/available?${params}`), 'Unable to load published times.');
      if (requestId === rescheduleRequestRef.current) setRescheduleSlots((Array.isArray(body) ? body : []).filter(isConsultationSession));
    } catch (failure) { if (requestId === rescheduleRequestRef.current) setRescheduleError(failure.message); }
    finally { if (requestId === rescheduleRequestRef.current) setRescheduleLoading(false); }
  }, []);

  useEffect(() => {
    if (rescheduleTarget && rescheduleDate) loadRescheduleSlots(rescheduleTarget, rescheduleDate);
  }, [rescheduleTarget, rescheduleDate, loadRescheduleSlots]);

  const confirmReschedule = async () => {
    if (!rescheduleTarget || !rescheduleSlot || saving) return;
    setSaving(rescheduleTarget._id); setRescheduleError(''); setNotice('');
    try {
      const freshParams = new URLSearchParams({ practitionerId: rescheduleTarget.practitioner._id, date: rescheduleDate });
      const fresh = await readJson(await authFetch(`/therapy/available?${freshParams}`), 'Unable to refresh availability.');
      if (!(Array.isArray(fresh) ? fresh : []).some((slot) => slot._id === rescheduleSlot._id)) {
        setRescheduleSlot(null); setReviewReschedule(false); await loadRescheduleSlots(rescheduleTarget, rescheduleDate);
        throw new Error('That time is no longer available. Select another published slot.');
      }
      const response = await authFetch(`/sessions/${rescheduleTarget._id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newSlotId: rescheduleSlot._id }) });
      await readJson(response, 'Appointment could not be rescheduled.');
      setNotice('Your appointment has been rescheduled.'); setRescheduleTarget(null); setSelectedAppointmentId(''); await loadAppointments();
    } catch (failure) {
      setRescheduleError(failure.message);
      if (failure.message.toLowerCase().includes('available') || failure.message.toLowerCase().includes('slot')) await loadRescheduleSlots(rescheduleTarget, rescheduleDate);
    } finally { setSaving(''); }
  };

  const cancel = async () => {
    if (!cancelTarget || saving) return;
    setSaving(cancelTarget._id); setError(''); setNotice('');
    try {
      const response = await authFetch(`/sessions/${cancelTarget._id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled', cancelledReason: cancelReason.trim() }) });
      await readJson(response, 'Appointment could not be cancelled.');
      setCancelTarget(null); setCancelReason(''); setNotice('Your appointment has been cancelled.'); await loadAppointments();
    } catch (failure) { setError(failure.message); }
    finally { setSaving(''); }
  };

  const clearFilters = () => setFilters({ from: '', to: '', practitioner: '', type: '', status: '', search: '' });
  const clearCount = Object.values(filters).filter(Boolean).length;

  return <main className="min-h-full bg-[#FBF7ED] px-4 py-6 text-stone-900 sm:px-6 lg:px-8">
    <div className="mx-auto max-w-7xl space-y-5">
      <header className={`${shell} flex flex-wrap items-center justify-between gap-4 bg-gradient-to-r from-[#fffaf0] via-white to-orange-50 p-5 sm:p-7`}><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-800">Your care schedule</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Appointments</h1><p className="mt-1 text-sm text-stone-600">Book, review, and manage your clinic consultations.</p></div><div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white px-3 py-2 text-xs font-medium text-amber-950"><CalendarDays size={15}/>{formatDate(today, { weekday: 'long', day: 'numeric', month: 'long' })}</div></header>
      {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}<button type="button" onClick={() => { setAppointmentLoading(true); setError(''); loadAppointments().catch((failure) => setError(failure.message)).finally(() => setAppointmentLoading(false)); }} className="ml-2 font-semibold underline">Retry</button></div>}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6" aria-label="Appointment summaries">{summary.map((item) => <button key={item.id} type="button" onClick={() => setActiveCategory(activeCategory === item.id ? 'all' : item.id)} aria-pressed={activeCategory === item.id} className={`${shell} p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md ${activeCategory === item.id ? 'border-amber-600 ring-2 ring-amber-600/15' : ''}`}><p className="text-xs font-semibold text-stone-600">{item.label}</p><p className={`mt-1 text-2xl font-semibold ${item.tone}`}>{appointmentLoading ? '–' : item.count}</p><p className="mt-1 line-clamp-1 text-[11px] text-stone-500">{item.hint}</p></button>)}</section>

      <section className={`${shell} overflow-hidden`} aria-label="Appointment calendar">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-100 p-4 sm:p-5"><div><h2 className="font-semibold">Calendar</h2><p className="mt-0.5 text-xs text-stone-500">Select a date to view its appointments.</p></div><div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => moveCalendar(-1)} aria-label="Previous calendar period" className="rounded-lg border border-stone-300 p-2 hover:bg-stone-50"><ArrowLeft size={16}/></button><button type="button" onClick={() => { setCalendarCursor(firstDateOfMonth(new Date())); setCalendarDay(today); }} className="min-h-9 rounded-lg border border-amber-200 px-3 text-xs font-semibold text-amber-900 hover:bg-amber-50">Today</button><button type="button" onClick={() => moveCalendar(1)} aria-label="Next calendar period" className="rounded-lg border border-stone-300 p-2 hover:bg-stone-50"><ArrowRight size={16}/></button><label className="sr-only" htmlFor="calendar-date">Select a calendar date</label><input id="calendar-date" type="date" value={calendarDay} onChange={(event) => selectDate(event.target.value)} className={`${field} w-40`}/><div className="flex rounded-lg border border-amber-200 bg-[#fffaf0] p-1">{['month', 'week', 'day'].map((mode) => <button key={mode} type="button" aria-pressed={calendarMode === mode} onClick={() => setCalendarMode(mode)} className={`rounded-md px-2.5 py-1.5 text-xs font-semibold capitalize ${calendarMode === mode ? 'bg-amber-800 text-white' : 'text-amber-950 hover:bg-amber-100'}`}>{mode}</button>)}</div></div></div>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-5"><h3 className="font-semibold">{calendarMode === 'month' ? formatDate(`${calendarCursor.getFullYear()}-${String(calendarCursor.getMonth() + 1).padStart(2, '0')}-01`, { month: 'long', year: 'numeric' }) : calendarMode === 'day' ? formatDate(calendarDay) : `Week of ${formatDate(calendarDay, { day: 'numeric', month: 'short' })}`}</h3><p className="text-xs text-stone-500">{calendarAppointments.length} appointment{calendarAppointments.length === 1 ? '' : 's'} in this view</p></div>
        {appointmentLoading ? <CalendarSkeleton/> : <CalendarGrid mode={calendarMode} cursor={calendarCursor} day={calendarDay} appointments={appointments} onSelectDate={selectDate} onSelectAppointment={(item) => setSelectedAppointmentId(item._id)}/>}
        <div className="border-t border-amber-100 bg-[#fffdf8] p-4 sm:p-5"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">{formatDate(calendarDay)} schedule</h3><span className="text-xs text-stone-500">{selectedDayAppointments.length} appointment{selectedDayAppointments.length === 1 ? '' : 's'}</span></div>{selectedDayAppointments.length ? <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{selectedDayAppointments.map((item) => <AppointmentLine key={item._id} appointment={item} onClick={() => setSelectedAppointmentId(item._id)}/>)}</div> : <p className="rounded-xl bg-stone-50 p-3 text-sm text-stone-600">No appointments on this date.</p>}</div>
      </section>

      <section className={`${shell} p-4 sm:p-5`} aria-label="Book a consultation"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Book a consultation</h2><p className="mt-1 text-sm text-stone-600">Choose a verified Vaidya and one of their published clinic slots.</p></div><span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900">Published slots only</span></div>{bookingError && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{bookingError}</p>}
        <label className="mt-4 block max-w-xl"><span className="mb-1.5 block text-xs font-semibold text-stone-700">Find a Vaidya</span><span className="relative block"><Search size={16} className="absolute left-3 top-3 text-stone-400"/><input value={providerQuery} onChange={(event) => { setProviderQuery(event.target.value); setSelectedPractitioner(''); }} placeholder="Search by name, specialization, or therapy" className={`${field} pl-9`}/></span></label>
        {practitionerLoading ? <div className="mt-4 grid gap-3 md:grid-cols-2">{[0, 1].map((value) => <div key={value} className="h-24 animate-pulse rounded-xl bg-amber-50"/> )}</div> : practitioners.length === 0 ? <p className="mt-3 text-sm text-stone-600">No verified Vaidyas matched this search.</p> : <div className="mt-4 grid gap-3 md:grid-cols-2">{practitioners.map((person) => <article key={person._id} className={`rounded-xl border p-4 transition ${selectedPractitioner === person._id ? 'border-amber-600 bg-[#fffaf0]' : 'border-amber-100 bg-[#fffdf8]'}`}><div className="flex items-start gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-amber-100 text-amber-800">{person.profileImageUrl ? <img src={person.profileImageUrl} alt="" className="h-full w-full object-cover"/> : <UserRound size={20}/>}</div><div className="min-w-0 flex-1"><h3 className="font-semibold">{person.name}</h3><p className="mt-0.5 text-xs text-stone-600">{person.qualifications?.join(' · ') || 'Qualifications not listed'}</p><p className="mt-1 text-xs text-amber-900">{person.practiceAreas?.join(' · ') || 'Specialization not listed'}</p>{person.practiceLocation?.city && <p className="mt-1 flex items-center gap-1 text-xs text-stone-500"><MapPin size={12}/>{[person.practiceLocation.city, person.practiceLocation.state].filter(Boolean).join(', ')}</p>}</div><span className="text-[11px] font-semibold text-emerald-800">Verified</span></div><div className="mt-3 flex items-center justify-between gap-2"><p className="text-xs text-stone-600">{Number(person.experience) > 0 ? `${person.experience} years experience` : 'Experience not listed'}{Number(person.consultationFee) > 0 ? ` · ₹${person.consultationFee}` : ''}</p><button type="button" onClick={() => setSelectedPractitioner(person._id)} className="min-h-9 rounded-lg bg-amber-800 px-3 text-xs font-semibold text-white hover:bg-amber-900">{selectedPractitioner === person._id ? 'Selected' : 'View slots'}</button></div></article>)}</div>}
        {selectedPractitioner && <div className="mt-4 rounded-2xl border border-amber-100 bg-[#fffaf0] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Available consultation slots</h3><p className="text-xs text-stone-600">{practitioners.find((person) => person._id === selectedPractitioner)?.name}</p></div><label className="mt-3 block max-w-xl text-sm">Reason for visit (optional)<textarea maxLength={500} value={visitReason} onChange={(event) => setVisitReason(event.target.value)} rows={2} className="mt-1 w-full rounded-xl border border-amber-200 bg-white p-3"/></label>{bookingSlotsLoading ? <p role="status" className="mt-3 rounded-lg bg-white p-3 text-sm">Loading published slots…</p> : bookingSlots.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{bookingSlots.slice(0, 30).map((slot) => <div key={slot._id} className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-white p-3"><div><p className="text-sm font-medium">{formatDate(slot.date)} · {slot.startTime}</p><p className="text-xs text-stone-600">{slot.durationMins || 60} minutes</p></div><button type="button" onClick={() => setBookingSlot(slot)} disabled={Boolean(saving)} className="min-h-9 rounded-lg bg-amber-800 px-3 text-xs font-semibold text-white hover:bg-amber-900 disabled:opacity-50">Review</button></div>)}</div> : <p className="mt-3 rounded-lg bg-white p-3 text-sm text-stone-600">No consultation slots are currently published for this Vaidya.</p>}</div>}
      </section>

      <section className={`${shell} overflow-hidden`} aria-label="Appointment history"><div className="border-b border-amber-100 p-4 sm:p-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-semibold">Appointment history</h2><p className="mt-1 text-sm text-stone-600">Search and filter your consultations.</p></div><label className="relative block w-full sm:max-w-xs"><span className="sr-only">Search appointments</span><Search size={15} className="absolute left-3 top-3 text-stone-400"/><input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Vaidya, type, or reference" className={`${field} pl-9`}/></label></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5"><label className="text-[11px] font-semibold text-stone-600">From<input type="date" value={filters.from} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} className={`${field} mt-1 text-xs`}/></label><label className="text-[11px] font-semibold text-stone-600">To<input type="date" value={filters.to} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} className={`${field} mt-1 text-xs`}/></label><label className="text-[11px] font-semibold text-stone-600">Practitioner<select value={filters.practitioner} onChange={(event) => setFilters((current) => ({ ...current, practitioner: event.target.value }))} className={`${field} mt-1 text-xs`}><option value="">All practitioners</option>{practitionersInHistory.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="text-[11px] font-semibold text-stone-600">Appointment type<input value={filters.type} onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value }))} placeholder="Any type" className={`${field} mt-1 text-xs`}/></label><label className="text-[11px] font-semibold text-stone-600">Status<select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))} className={`${field} mt-1 text-xs`}><option value="">All statuses</option>{['scheduled', 'confirmed', 'in-progress', 'completed', 'cancelled'].map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label></div><div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-stone-500">Showing {filteredAppointments.length ? (historyPage - 1) * pageSize + 1 : 0}–{Math.min(historyPage * pageSize, filteredAppointments.length)} of {filteredAppointments.length}</p><div className="flex gap-2">{activeCategory !== 'all' && <button type="button" onClick={() => setActiveCategory('all')} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-50">Show all categories</button>}{clearCount > 0 && <button type="button" onClick={clearFilters} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-50">Clear filters</button>}</div></div></div>
        {appointmentLoading ? <div className="space-y-3 p-4">{[0, 1, 2].map((value) => <div key={value} className="h-20 animate-pulse rounded-xl bg-amber-50"/> )}</div> : visibleAppointments.length ? <div className="divide-y divide-amber-100 px-4">{visibleAppointments.map((item) => <AppointmentRow key={item._id} appointment={item} onDetails={() => setSelectedAppointmentId(item._id)}/>)}</div> : <div className="p-8 text-center"><p className="font-semibold">No appointments in this view</p><p className="mt-1 text-sm text-stone-600">Try changing your category or filters.</p></div>}
        {!appointmentLoading && totalPages > 1 && <div className="flex items-center justify-center gap-3 border-t border-amber-100 p-4"><button type="button" disabled={historyPage <= 1} onClick={() => setHistoryPage((current) => current - 1)} className="min-h-9 rounded-lg border border-amber-200 px-3 text-xs font-semibold disabled:opacity-40">Previous</button><span className="text-xs text-stone-600">Page {historyPage} of {totalPages}</span><button type="button" disabled={historyPage >= totalPages} onClick={() => setHistoryPage((current) => current + 1)} className="min-h-9 rounded-lg border border-amber-200 px-3 text-xs font-semibold disabled:opacity-40">Next</button></div>}
      </section>
    </div>

    {bookingSlot && <ConfirmDialog title="Review consultation booking" onClose={() => setBookingSlot(null)}><p className="text-sm">{practitioners.find((person) => person._id === selectedPractitioner)?.name}</p><p className="mt-1 text-sm">{formatDate(bookingSlot.date)} · {bookingSlot.startTime} · {bookingSlot.durationMins || 60} minutes</p>{visitReason.trim() && <p className="mt-2 text-sm">Reason: {visitReason.trim()}</p>}<p className="mt-3 text-xs text-stone-600">The slot will be checked again before booking.</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setBookingSlot(null)} className="min-h-10 rounded-lg border border-stone-300 px-3 text-sm">Back</button><button type="button" disabled={Boolean(saving)} onClick={async () => { const slot = bookingSlot; setBookingSlot(null); await book(slot); }} className="min-h-10 rounded-lg bg-amber-800 px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Booking…' : 'Confirm booking'}</button></div></ConfirmDialog>}

    {selectedAppointment && <ConfirmDialog title="Appointment details" onClose={() => setSelectedAppointmentId('')} wide><AppointmentDetails appointment={selectedAppointment} onReschedule={() => openReschedule(selectedAppointment)} onCancel={() => { setCancelTarget(selectedAppointment); setCancelReason(''); }}/></ConfirmDialog>}

    {cancelTarget && <ConfirmDialog title="Cancel appointment?" onClose={() => { if (!saving) setCancelTarget(null); }}><p className="text-sm text-stone-600">{formatDate(cancelTarget.date)} · {cancelTarget.startTime} with {cancelTarget.practitioner?.name || 'your Vaidya'}.</p><p className="mt-2 text-xs text-stone-500">Confirmed or checked-in appointments must be changed through the clinic.</p><label className="mt-4 block text-sm font-medium">Cancellation reason (optional)<textarea rows={3} maxLength={1000} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} className="mt-1 w-full rounded-xl border border-stone-300 p-3 text-sm"/></label><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setCancelTarget(null)} className="min-h-10 rounded-lg border border-stone-300 px-3 text-sm">Keep appointment</button><button type="button" disabled={Boolean(saving)} onClick={cancel} className="min-h-10 rounded-lg bg-red-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Cancelling…' : 'Confirm cancellation'}</button></div></ConfirmDialog>}

    {rescheduleTarget && <ConfirmDialog title="Reschedule appointment" onClose={() => { if (!saving) setRescheduleTarget(null); }} wide><p className="text-sm text-stone-600">Current: {formatDate(rescheduleTarget.date)} at {rescheduleTarget.startTime} · {rescheduleTarget.practitioner?.name || 'Vaidya'}</p><label className="mt-4 block max-w-xs text-sm font-medium">Choose a new date<input type="date" min={today} value={rescheduleDate} onChange={(event) => setRescheduleDate(event.target.value)} className={`${field} mt-1`}/></label>{rescheduleError && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{rescheduleError}</p>}{rescheduleLoading ? <p role="status" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm">Loading published slots…</p> : <div className="mt-3 grid gap-2 sm:grid-cols-2">{rescheduleSlots.length ? rescheduleSlots.map((slot) => <button key={slot._id} type="button" onClick={() => { setRescheduleSlot(slot); setReviewReschedule(false); }} className={`flex min-h-14 items-center justify-between rounded-xl border p-3 text-left ${rescheduleSlot?._id === slot._id ? 'border-amber-700 bg-amber-50' : 'border-amber-200 hover:bg-amber-50'}`}><span><strong className="block text-sm">{formatDate(slot.date)} · {slot.startTime}</strong><span className="text-xs text-stone-600">{slot.durationMins || 60} minutes</span></span><span className="text-xs font-semibold text-amber-900">{rescheduleSlot?._id === slot._id ? 'Selected' : 'Select'}</span></button>) : !rescheduleError && <p className="rounded-lg bg-stone-50 p-3 text-sm text-stone-600 sm:col-span-2">No published appointment slots are available on this date.</p>}</div>}{rescheduleSlot && <div className="mt-4 rounded-xl border border-amber-200 bg-[#fffaf0] p-4"><p className="text-sm font-semibold">Review new time</p><div className="mt-2 grid gap-2 sm:grid-cols-2"><p className="text-sm">Old: {formatDate(rescheduleTarget.date)} · {rescheduleTarget.startTime}</p><p className="text-sm">New: {formatDate(rescheduleSlot.date)} · {rescheduleSlot.startTime}</p></div>{reviewReschedule ? <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setReviewReschedule(false)} className="min-h-10 rounded-lg border border-stone-300 px-3 text-sm">Back</button><button type="button" disabled={Boolean(saving)} onClick={confirmReschedule} className="min-h-10 rounded-lg bg-amber-800 px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Updating…' : 'Confirm reschedule'}</button></div> : <button type="button" onClick={() => setReviewReschedule(true)} className="mt-4 min-h-10 rounded-lg bg-amber-800 px-4 text-sm font-semibold text-white">Review change</button>}</div>}</ConfirmDialog>}
  </main>;
}

function CalendarGrid({ mode, cursor, day, appointments, onSelectDate, onSelectAppointment }) {
  let dates = [];
  if (mode === 'month') {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1, 12);
    const start = new Date(first); start.setDate(start.getDate() - start.getDay());
    dates = Array.from({ length: 42 }, (_, index) => { const value = new Date(start); value.setDate(value.getDate() + index); return value; });
  } else if (mode === 'week') {
    const start = dateFromKey(day); start.setDate(start.getDate() - start.getDay());
    dates = Array.from({ length: 7 }, (_, index) => { const value = new Date(start); value.setDate(value.getDate() + index); return value; });
  } else dates = [dateFromKey(day)];
  const selectedKey = day;
  return <div className="p-3 sm:p-5"><div className={`grid ${mode === 'day' ? 'grid-cols-1' : 'grid-cols-7'} border-l border-t border-amber-100`}>{mode !== 'day' && ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((weekday) => <div key={weekday} className="border-b border-r border-amber-100 bg-[#fffaf0] px-1 py-2 text-center text-[10px] font-semibold text-stone-600 sm:text-xs">{weekday}</div>)}{dates.map((date) => {
    const key = dateKey(date); const onMonth = date.getMonth() === cursor.getMonth(); const dayItems = appointments.filter((item) => dateKey(item.date) === key).sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
    return <div key={key} className={`${mode === 'day' ? 'min-h-56' : 'min-h-[70px] sm:min-h-[98px]'} border-b border-r border-amber-100 p-1 sm:p-2 ${mode === 'month' && !onMonth ? 'bg-stone-50/70' : 'bg-white'} ${key === selectedKey ? 'ring-2 ring-inset ring-amber-600/70' : ''}`}><button type="button" onClick={() => onSelectDate(key)} aria-label={`Select ${formatDate(key)}`} className={`flex h-7 w-7 items-center justify-center rounded-full text-xs ${key === clinicToday() ? 'bg-amber-800 font-bold text-white' : key === selectedKey ? 'bg-amber-100 font-bold text-amber-950' : 'text-stone-700 hover:bg-amber-50'} ${mode === 'month' && !onMonth ? 'opacity-40' : ''}`}>{date.getDate()}</button>{mode === 'month' ? <div className="mt-1 space-y-0.5">{dayItems.slice(0, 2).map((item) => <button key={item._id} type="button" onClick={() => onSelectAppointment(item)} className={`hidden w-full truncate rounded px-1 py-0.5 text-left text-[10px] sm:block ${eventColor(item)}`}>{item.startTime} {item.practitioner?.name || item.sessionName}</button>)}{dayItems.length > 2 && <button type="button" onClick={() => onSelectDate(key)} className="hidden text-[10px] text-amber-900 hover:underline sm:block">+{dayItems.length - 2} more</button>}{dayItems.length > 0 && <div className="flex gap-0.5 sm:hidden">{dayItems.slice(0, 3).map((item) => <span key={item._id} className={`h-1.5 w-1.5 rounded-full ${dotColor(item)}`} />)}</div>}</div> : <div className="mt-2 space-y-1">{dayItems.map((item) => <button key={item._id} type="button" onClick={() => onSelectAppointment(item)} className={`w-full rounded-lg border p-2 text-left text-[11px] sm:text-xs ${eventColor(item)}`}><span className="font-semibold">{item.startTime}</span><span className="ml-1">{item.practitioner?.name || item.sessionName}</span><span className="ml-1 hidden capitalize sm:inline">· {statusLabel(item.status)}</span></button>)}</div>}</div>;
  })}</div></div>;
}

function eventColor(item) {
  if (item.status === 'cancelled') return 'border-red-200 bg-red-50 text-red-800';
  if (item.status === 'completed') return 'border-stone-200 bg-stone-100 text-stone-700';
  if (item.status === 'confirmed') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (item.scheduleHistory?.length) return 'border-violet-200 bg-violet-50 text-violet-900';
  return 'border-blue-200 bg-blue-50 text-blue-900';
}
function dotColor(item) { return item.status === 'cancelled' ? 'bg-red-500' : item.status === 'completed' ? 'bg-stone-500' : item.status === 'confirmed' ? 'bg-emerald-500' : item.scheduleHistory?.length ? 'bg-violet-500' : 'bg-blue-500'; }

function CalendarSkeleton() { return <div className="grid grid-cols-7 animate-pulse p-4">{Array.from({ length: 35 }, (_, index) => <div key={index} className="m-px h-16 rounded border border-amber-100 bg-amber-50 sm:h-20"/> )}</div>; }

function AppointmentLine({ appointment, onClick }) {
  return <button type="button" onClick={onClick} className={`flex w-full items-center justify-between gap-2 rounded-xl border p-3 text-left transition hover:shadow-sm ${eventColor(appointment)}`}><span className="min-w-0"><span className="block truncate text-sm font-semibold">{appointment.startTime} · {appointment.practitioner?.name || appointment.sessionName}</span><span className="mt-0.5 block truncate text-xs">{appointment.sessionName || appointment.therapyType}</span></span><StatusBadge status={appointment.status}/></button>;
}

function AppointmentRow({ appointment, onDetails }) {
  return <article className="flex flex-wrap items-center justify-between gap-3 py-4"><div className="flex min-w-0 items-start gap-3"><span className="rounded-xl bg-amber-50 p-2.5 text-amber-800"><CalendarDays size={18}/></span><div className="min-w-0"><p className="font-semibold">{formatDate(appointment.date)} · {appointment.startTime}</p><p className="mt-1 truncate text-sm text-stone-600">{appointment.practitioner?.name || 'Vaidya'} · {appointment.sessionName || appointment.therapyType} · {appointment.durationMins || 60} min</p>{appointment.scheduleHistory?.length > 0 && <p className="mt-1 text-xs font-medium text-violet-800">Rescheduled {appointment.scheduleHistory.length} time{appointment.scheduleHistory.length === 1 ? '' : 's'}</p>}</div></div><div className="flex items-center gap-2"><StatusBadge status={appointment.status}/><button type="button" onClick={onDetails} className="min-h-9 rounded-lg border border-amber-300 px-3 text-xs font-semibold text-amber-950 hover:bg-amber-50">Details</button></div></article>;
}

function StatusBadge({ status }) { return <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusStyle[status] || 'border-stone-200 bg-stone-50 text-stone-700'}`}>{statusLabel(status)}</span>; }

function AppointmentDetails({ appointment, onReschedule, onCancel }) {
  const location = appointment.practitioner?.practiceLocation;
  const clinic = [location?.address, location?.city, location?.state, location?.pincode].filter(Boolean).join(', ');
  const scheduleHistory = appointment.scheduleHistory || [];
  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-[#fffaf0] p-4"><div><p className="font-semibold">{appointment.practitioner?.name || 'Vaidya not listed'}</p><p className="mt-1 text-sm text-stone-600">{appointment.practitioner?.practiceAreas?.join(' · ') || appointment.sessionName || appointment.therapyType}</p></div><StatusBadge status={appointment.status}/></div>
    {appointment.checkedInAt && <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"><Check size={16}/>Checked in at {new Date(appointment.checkedInAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</p>}
    <div className="grid gap-3 sm:grid-cols-2"><Detail label="Appointment reference" value={String(appointment._id)}/><Detail label="Appointment type" value={appointment.sessionName || appointment.therapyType}/><Detail label="Date and time" value={`${formatDate(appointment.date)} · ${appointment.startTime}`}/><Detail label="Duration" value={`${appointment.durationMins || 60} minutes`}/><Detail label="Booked on" value={appointment.createdAt ? formatDate(appointment.createdAt) : 'Booking date unavailable'}/><Detail label="Clinic" value={clinic || 'Clinic location not listed'}/></div>
    {appointment.therapySnapshot?.preparationInstructions && <Detail label="Preparation instructions" value={appointment.therapySnapshot.preparationInstructions}/>}
    {appointment.therapySnapshot?.postTherapyInstructions && <Detail label="After-visit instructions" value={appointment.therapySnapshot.postTherapyInstructions}/>}
    {appointment.cancelledReason && <Detail label="Cancellation information" value={appointment.cancelledReason}/>}
    {scheduleHistory.length > 0 && <section className="rounded-xl border border-violet-100 bg-violet-50/60 p-4"><h3 className="text-sm font-semibold text-violet-950">Rescheduling history</h3><div className="mt-2 space-y-2">{scheduleHistory.map((entry, index) => <p key={`${entry.changedAt || ''}-${index}`} className="text-xs leading-5 text-violet-950">{formatDate(entry.from?.date)} {entry.from?.startTime} → {formatDate(entry.to?.date)} {entry.to?.startTime}{entry.changedAt ? ` · ${formatDate(entry.changedAt)}` : ''}</p>)}</div></section>}
    {appointment.status === 'scheduled' && <div className="flex flex-wrap justify-end gap-2 border-t border-amber-100 pt-4">{!appointment.checkedInAt && <button type="button" onClick={onReschedule} className="min-h-10 rounded-lg border border-amber-300 px-3 text-sm font-semibold text-amber-950">Reschedule</button>}<button type="button" onClick={onCancel} className="min-h-10 rounded-lg border border-red-200 px-3 text-sm font-semibold text-red-700">Cancel appointment</button></div>}
    {appointment.checkedInAt && appointment.status === 'scheduled' && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-950">This appointment has been checked in. Contact the clinic to reschedule.</p>}
    {appointment.status === 'confirmed' && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-950">To change a confirmed appointment, please contact the clinic.</p>}
    {['completed', 'cancelled', 'in-progress'].includes(appointment.status) && <p className="rounded-lg bg-stone-50 p-3 text-xs text-stone-600">This appointment cannot be cancelled or rescheduled from the patient portal.</p>}
  </div>;
}

function Detail({ label, value }) { return <div className="min-w-0 rounded-xl border border-stone-100 bg-white p-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">{label}</p><p className="mt-1 break-words text-sm text-stone-900">{value || 'Not listed'}</p></div>; }

function ConfirmDialog({ title, onClose, children, wide = false }) {
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/45 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section role="dialog" aria-modal="true" aria-labelledby="appointment-dialog-title" className={`max-h-[94vh] w-full overflow-y-auto rounded-t-3xl bg-[#fffdf8] p-5 shadow-2xl sm:rounded-3xl sm:p-6 ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'}`}><header className="mb-4 flex items-start justify-between gap-3"><h2 id="appointment-dialog-title" className="text-lg font-semibold">{title}</h2><button type="button" onClick={onClose} aria-label="Close dialog" className="rounded-lg p-1 text-stone-500 hover:bg-amber-50"><X size={19}/></button></header>{children}</section></div>;
}
