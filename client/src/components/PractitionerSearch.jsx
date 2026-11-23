import React, { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowLeft, ArrowRight, CalendarDays, Check, Clock3, MapPin, Search, ShieldCheck, Stethoscope, UserRound, X } from 'lucide-react';
import authFetch from '../utils/apiClient.js';

const card = 'rounded-2xl border border-amber-200/80 bg-white shadow-sm';
const field = 'min-h-11 w-full rounded-xl border border-stone-300 bg-white px-3.5 text-sm text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-amber-700 focus:ring-2 focus:ring-amber-700/15';
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
const readJson = async (response, fallback) => {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(body.message || body.error || fallback); error.status = response.status; throw error; }
  return body;
};
const locationText = (location = {}) => [location.address, location.city, location.state, location.pincode, location.country].filter(Boolean).join(', ');

export default function PractitionerSearch({ user, onAssignmentSuccess }) {
  const [filters, setFilters] = useState({ q: '', practiceArea: '', city: '', state: '', availableDate: '', sort: 'relevance' });
  const [practitioners, setPractitioners] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [slotDate, setSlotDate] = useState(today());
  const [slots, setSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState('');
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [reviewing, setReviewing] = useState(false);
  const [booking, setBooking] = useState(false);
  const [bookingMessage, setBookingMessage] = useState('');
  const [bookingError, setBookingError] = useState('');
  const [searchVersion, setSearchVersion] = useState(0);
  const [assignedPractitioner, setAssignedPractitioner] = useState(null);
  const [assignmentTarget, setAssignmentTarget] = useState(null);
  const [assignmentSaving, setAssignmentSaving] = useState(false);
  const [assignmentError, setAssignmentError] = useState('');

  const activeFilterCount = useMemo(() => Object.entries(filters).filter(([key, value]) => key !== 'sort' && value).length, [filters]);

  useEffect(() => {
    if (user?.userType !== 'patient') return undefined;
    let current = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError('');
      const params = new URLSearchParams({ page: String(page), pageSize: '9', sort: filters.sort });
      Object.entries(filters).forEach(([key, value]) => { if (value && key !== 'sort') params.set(key, value); });
      try {
        const body = await readJson(await authFetch(`/api/practitioner-search/search?${params}`), 'Unable to find Vaidyas right now.');
        if (!current) return;
        setPractitioners(body.practitioners || []);
        setTotalCount(body.count || 0);
        setTotalPages(body.totalPages || 0);
      } catch (searchFailure) {
        if (current) { setError(searchFailure.message); setPractitioners([]); setTotalCount(0); setTotalPages(0); }
      } finally { if (current) setLoading(false); }
    }, searchVersion ? 0 : 220);
    return () => { current = false; clearTimeout(timer); };
  }, [filters, page, searchVersion, user?.userType]);

  useEffect(() => {
    if (user?.userType !== 'patient') return undefined;
    let current = true;
    authFetch('/api/practitioner-search/assigned/current')
      .then((response) => readJson(response, 'Unable to load your assigned Vaidya.'))
      .then((body) => { if (current) setAssignedPractitioner(body.assigned ? body.practitioner : null); })
      .catch(() => { if (current) setAssignedPractitioner(null); });
    return () => { current = false; };
  }, [user?.userType]);

  const loadSlots = async (practitionerId, date) => {
    if (!practitionerId || !date) return;
    setSlotsLoading(true);
    setSlotsError('');
    setSelectedSlot(null);
    try {
      const params = new URLSearchParams({ practitionerId, date, includeUnavailable: 'true' });
      const result = await readJson(await authFetch(`/therapy/available?${params}`), 'Unable to load available consultation times.');
      setSlots(Array.isArray(result) ? result : []);
    } catch (slotFailure) { setSlots([]); setSlotsError(slotFailure.message); }
    finally { setSlotsLoading(false); }
  };

  const openPractitioner = async (practitioner, mode = 'profile') => {
    setSelected({ ...practitioner, mode });
    setSlotDate(filters.availableDate || today());
    setSlots([]); setSelectedSlot(null); setReviewing(false); setBookingMessage(''); setBookingError('');
    setProfileLoading(true);
    try {
      const body = await readJson(await authFetch(`/api/practitioner-search/${practitioner._id}`), 'Unable to load Vaidya profile.');
      const profile = body.practitioner;
      setSelected({ ...profile, mode });
      await loadSlots(profile._id, filters.availableDate || today());
    } catch (profileError) { setBookingError(profileError.message); }
    finally { setProfileLoading(false); }
  };

  const confirmBooking = async () => {
    if (!selected || !selectedSlot || booking) return;
    setBooking(true); setBookingError(''); setBookingMessage('');
    try {
      // Re-read availability immediately before booking; the API also checks the slot transactionally.
      const params = new URLSearchParams({ practitionerId: selected._id, date: slotDate });
      const currentSlots = await readJson(await authFetch(`/therapy/available?${params}`), 'Unable to refresh availability.');
      if (!currentSlots.some((slot) => slot._id === selectedSlot._id)) {
        setSelectedSlot(null); setReviewing(false);
        await loadSlots(selected._id, slotDate);
        throw new Error('That time is no longer available. Please choose another consultation time.');
      }
      const body = await readJson(await authFetch(`/therapy/book/${selectedSlot._id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      }), 'This consultation could not be booked.');
      setBookingMessage('Your consultation is booked. Find it in My Appointments.');
      const bookedSlot = body.session || selectedSlot;
      setSelectedSlot(bookedSlot);
      setSlots((current) => current.filter((slot) => slot._id !== bookedSlot._id));
      setReviewing(false);
    } catch (bookingFailure) {
      if (bookingFailure.status === 409) {
        setSelectedSlot(null); setReviewing(false);
        await loadSlots(selected._id, slotDate);
        setBookingError('That consultation time is no longer available. Please choose another time.');
      } else setBookingError(bookingFailure.message);
    }
    finally { setBooking(false); }
  };

  const confirmAssignment = async () => {
    if (!assignmentTarget || assignmentSaving) return;
    setAssignmentSaving(true); setAssignmentError('');
    try {
      const body = await readJson(await authFetch('/api/practitioner-search/assign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ practitionerId: assignmentTarget._id }),
      }), 'Unable to set this Vaidya as your practitioner.');
      setAssignedPractitioner(body.practitioner || assignmentTarget);
      setAssignmentTarget(null);
      if (onAssignmentSuccess) onAssignmentSuccess(body.practitioner || assignmentTarget);
    } catch (failure) { setAssignmentError(failure.message); }
    finally { setAssignmentSaving(false); }
  };

  const removeAssignment = async () => {
    setAssignmentSaving(true); setAssignmentError('');
    try {
      await readJson(await authFetch('/api/practitioner-search/assigned', { method: 'DELETE' }), 'Unable to remove the assigned Vaidya.');
      setAssignedPractitioner(null);
    } catch (failure) { setAssignmentError(failure.message); }
    finally { setAssignmentSaving(false); }
  };

  const updateFilter = (key, value) => { setPage(1); setFilters((current) => ({ ...current, [key]: value })); };
  const clearFilters = () => { setFilters({ q: '', practiceArea: '', city: '', state: '', availableDate: '', sort: 'relevance' }); setPage(1); };

  if (user?.userType !== 'patient') return <main className="mx-auto max-w-3xl p-6"><section className={`${card} p-6`}><h1 className="text-xl font-semibold">Find a Vaidya</h1><p className="mt-2 text-sm text-stone-600">This discovery page is available in the patient portal.</p></section></main>;

  return <main className="min-h-full bg-[#FBF7ED] px-4 py-6 text-stone-900 sm:px-6 lg:px-8">
    <div className="mx-auto max-w-7xl space-y-5">
      <header className={`${card} overflow-hidden bg-gradient-to-r from-[#fffaf0] via-white to-orange-50 p-5 sm:p-7`}>
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-800">AyurSutra care network</p><h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Find your Vaidya</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-stone-600">Discover verified Panchakarma practitioners, explore their experience and clinic details, and book a published consultation time.</p></div>
          <div className="inline-flex items-center gap-2 self-start rounded-full border border-amber-200 bg-white px-3 py-2 text-sm text-amber-950 md:self-auto"><ShieldCheck size={16} className="text-amber-800"/>Verified practitioners</div>
        </div>
      </header>

      {(assignedPractitioner || assignmentError) && <section className={`${card} flex flex-wrap items-center justify-between gap-3 p-4`}><div><p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Your care team</p><p className="mt-1 text-sm">{assignedPractitioner ? <>Your assigned Vaidya: <strong>{assignedPractitioner.name}</strong></> : 'Your assigned Vaidya could not be updated.'}</p>{assignmentError && <p role="alert" className="mt-1 text-xs text-red-700">{assignmentError}</p>}</div>{assignedPractitioner && <button type="button" disabled={assignmentSaving} onClick={removeAssignment} className="min-h-10 rounded-lg border border-stone-300 px-3 text-sm font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-50">{assignmentSaving ? 'Updating…' : 'Remove assignment'}</button>}</section>}

      <section className={`${card} p-4 sm:p-5`} aria-label="Search and filter Vaidyas">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <label className="sm:col-span-2"><span className="mb-1.5 block text-xs font-semibold text-stone-700">Name or expertise</span><span className="relative block"><Search size={17} className="absolute left-3 top-3 text-stone-400"/><input className={`${field} pl-9`} type="search" placeholder="Vaidya name or therapy" value={filters.q} onChange={(e) => updateFilter('q', e.target.value)} /></span></label>
          <label><span className="mb-1.5 block text-xs font-semibold text-stone-700">Specialization</span><input className={field} placeholder="e.g. Panchakarma" value={filters.practiceArea} onChange={(e) => updateFilter('practiceArea', e.target.value)} /></label>
          <label><span className="mb-1.5 block text-xs font-semibold text-stone-700">City</span><input className={field} placeholder="Any city" value={filters.city} onChange={(e) => updateFilter('city', e.target.value)} /></label>
          <label><span className="mb-1.5 block text-xs font-semibold text-stone-700">State</span><input className={field} placeholder="Any state" value={filters.state} onChange={(e) => updateFilter('state', e.target.value)} /></label>
          <label><span className="mb-1.5 block text-xs font-semibold text-stone-700">Available on</span><input className={field} type="date" min={today()} value={filters.availableDate} onChange={(e) => updateFilter('availableDate', e.target.value)} /></label>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-amber-100 pt-4">
          <p className="text-xs text-stone-500">{activeFilterCount ? `${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'} applied` : 'Search verified profiles and published consultation slots.'}</p>
          <div className="flex flex-wrap items-center gap-2"><label className="flex items-center gap-2 text-xs font-medium text-stone-700">Sort by<select className="min-h-10 rounded-lg border border-stone-300 bg-white px-2.5 text-sm" value={filters.sort} onChange={(e) => updateFilter('sort', e.target.value)}><option value="relevance">Name</option><option value="experience">Experience</option></select></label>{activeFilterCount > 0 && <button type="button" onClick={clearFilters} className="min-h-10 rounded-lg px-3 text-sm font-semibold text-amber-900 hover:bg-amber-50">Clear filters</button>}</div>
        </div>
      </section>

      <section aria-live="polite" aria-busy={loading}>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2"><div><h2 className="text-lg font-semibold">Practitioners</h2><p className="text-sm text-stone-600">{loading ? 'Finding matching Vaidyas…' : `${totalCount} ${totalCount === 1 ? 'profile' : 'profiles'} found`}</p></div></div>
        {loading ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <div key={i} className={`${card} animate-pulse p-5`}><div className="flex gap-3"><div className="h-14 w-14 rounded-2xl bg-amber-100"/><div className="flex-1 space-y-2"><div className="h-4 w-2/3 rounded bg-amber-100"/><div className="h-3 w-1/2 rounded bg-stone-100"/></div></div><div className="mt-5 h-16 rounded-xl bg-stone-100"/><div className="mt-5 h-10 rounded-xl bg-amber-100"/></div>)}</div>
          : error ? <div className={`${card} p-6 text-center`} role="alert"><p className="font-semibold">We couldn’t load Vaidyas</p><p className="mt-1 text-sm text-stone-600">{error}</p><button type="button" onClick={() => setSearchVersion((n) => n + 1)} className="mt-4 rounded-xl bg-amber-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-900">Try again</button></div>
            : practitioners.length === 0 ? <div className={`${card} p-8 text-center`}><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-800"><Stethoscope size={22}/></span><h3 className="mt-3 font-semibold">No Vaidyas match these filters</h3><p className="mt-1 text-sm text-stone-600">Try another name, therapy, location, or date.</p>{activeFilterCount > 0 && <button type="button" onClick={clearFilters} className="mt-4 rounded-xl border border-amber-300 px-4 py-2.5 text-sm font-semibold text-amber-900 hover:bg-amber-50">Clear all filters</button>}</div>
              : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{practitioners.map((practitioner) => <PractitionerCard key={practitioner._id} practitioner={practitioner} hasSlotOnDate={Boolean(filters.availableDate)} isAssigned={String(assignedPractitioner?._id || '') === String(practitioner._id)} onView={() => openPractitioner(practitioner)} onAvailability={() => openPractitioner(practitioner, 'availability')} onBook={() => openPractitioner(practitioner, 'booking')}/>)}</div>}
      </section>

      {!loading && !error && totalPages > 1 && <nav className="flex items-center justify-center gap-3" aria-label="Practitioner pages"><button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-amber-200 bg-white px-3 text-sm font-semibold text-amber-950 disabled:opacity-40"><ArrowLeft size={15}/>Previous</button><span className="text-sm text-stone-600">Page {page} of {totalPages}</span><button type="button" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-amber-200 bg-white px-3 text-sm font-semibold text-amber-950 disabled:opacity-40">Next<ArrowRight size={15}/></button></nav>}
    </div>

    {selected && <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/45 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !booking) setSelected(null); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="vaidya-detail-title" className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-[#fffdf8] shadow-2xl sm:rounded-3xl">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-amber-100 bg-[#fffdf8]/95 p-4 backdrop-blur sm:p-5"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-800">Verified Panchakarma care</p><h2 id="vaidya-detail-title" className="mt-1 text-xl font-semibold">{selected.name || 'Vaidya profile'}</h2></div><button type="button" aria-label="Close profile" onClick={() => { if (!booking) setSelected(null); }} className="rounded-xl p-2 text-stone-500 hover:bg-amber-50 hover:text-stone-900"><X size={20}/></button></header>
        <div className="space-y-5 p-4 sm:p-6">
          {profileLoading ? <div role="status" className="space-y-3"><div className="h-24 animate-pulse rounded-2xl bg-amber-100"/><div className="h-32 animate-pulse rounded-2xl bg-stone-100"/><p className="text-center text-sm text-stone-500">Loading Vaidya profile…</p></div>
            : <>
              {bookingError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{bookingError}</p>}
              {bookingMessage && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"><p className="flex items-center gap-2 font-semibold"><Check size={17}/>Consultation confirmed</p><p className="mt-1">{bookingMessage}</p>{selectedSlot && <p className="mt-2">{new Date(selectedSlot.date).toLocaleDateString()} at {selectedSlot.startTime} · {selected.name}</p>}</div>}
              <div className="flex flex-col gap-4 rounded-2xl border border-amber-100 bg-gradient-to-br from-[#fffaf0] to-white p-4 sm:flex-row sm:items-center"><Avatar practitioner={selected} size="large"/><div className="min-w-0 flex-1"><p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800"><ShieldCheck size={14}/>Verified practitioner</p><h3 className="mt-1 text-xl font-semibold">{selected.name}</h3><p className="mt-1 text-sm text-stone-600">{selected.qualifications?.length ? selected.qualifications.join(' · ') : 'Qualifications not listed'}</p>{locationText(selected.practiceLocation) && <p className="mt-2 flex items-center gap-1.5 text-sm text-stone-600"><MapPin size={15}/>{locationText(selected.practiceLocation)}</p>}</div>
                <div className="rounded-xl bg-white px-4 py-3 text-sm shadow-sm"><p className="text-xs text-stone-500">Experience</p><p className="font-semibold">{Number(selected.experience) > 0 ? `${selected.experience} years` : 'Not listed'}</p></div></div>
              <div className="grid gap-4 sm:grid-cols-2"><DetailBlock title="Professional introduction">{selected.bio || 'No professional description provided.'}</DetailBlock><DetailBlock title="Specializations"><TagList items={selected.practiceAreas} empty="No specializations listed."/></DetailBlock><DetailBlock title="Panchakarma expertise"><TagList items={selected.practiceAreas} empty="No therapy expertise listed."/></DetailBlock><DetailBlock title="Qualifications and education"><TagList items={selected.qualifications} empty="No qualifications listed."/></DetailBlock></div>
              <DetailBlock title="Clinic information">{locationText(selected.practiceLocation) || 'Clinic details are not listed.'}{selected.consultationFee > 0 && <p className="mt-2 font-medium text-stone-800">Consultation fee: ₹{selected.consultationFee}</p>}</DetailBlock>
              <DetailBlock title="Published working hours">{selected.availabilitySchedule?.filter((item) => item.isAvailable && item.dayOfWeek && item.startTime && item.endTime).length ? <div className="grid gap-x-5 gap-y-1 sm:grid-cols-2">{selected.availabilitySchedule.filter((item) => item.isAvailable && item.dayOfWeek && item.startTime && item.endTime).map((item) => <p key={item.dayOfWeek} className="flex items-center justify-between text-sm"><span>{item.dayOfWeek}</span><span className="text-stone-600">{item.startTime}–{item.endTime}</span></p>)}</div> : 'No recurring working hours published.'}</DetailBlock>

              <section className={`${card} p-4 sm:p-5`}><div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="font-semibold">Available consultation times</h3><p className="mt-1 text-sm text-stone-600">Only published, unbooked slots are shown.</p></div><label className="w-full sm:w-48"><span className="mb-1 block text-xs font-semibold text-stone-700">Choose appointment date</span><input className={field} type="date" min={today()} value={slotDate} onChange={(event) => { setSlotDate(event.target.value); setReviewing(false); setBookingError(''); loadSlots(selected._id, event.target.value); }}/></label></div>
                {slotsLoading ? <p role="status" className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-950">Checking published times…</p> : slotsError ? <div role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{slotsError}<button type="button" onClick={() => loadSlots(selected._id, slotDate)} className="ml-2 font-semibold underline">Retry</button></div> : slots.length ? <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">{slots.map((slot) => <button key={slot._id} type="button" disabled={!slot.isAvailable || Boolean(bookingMessage) || booking} aria-label={`${slot.startTime}, ${slot.isAvailable ? 'available' : 'unavailable'}`} onClick={() => { if (!slot.isAvailable) return; setSelectedSlot(slot); setReviewing(false); setBookingError(''); }} className={`min-h-12 rounded-xl border px-3 text-sm font-semibold transition ${selectedSlot?._id === slot._id ? 'border-amber-800 bg-amber-800 text-white' : slot.isAvailable ? 'border-amber-200 bg-white text-amber-950 hover:border-amber-500 hover:bg-amber-50' : 'cursor-not-allowed border-stone-200 bg-stone-100 text-stone-400'} disabled:cursor-not-allowed`}><span className="inline-flex items-center gap-2"><Clock3 size={15}/>{slot.startTime}</span><span className="mt-0.5 block text-xs font-normal">{slot.isAvailable ? `${slot.durationMins || 60} minutes` : 'Unavailable'}</span></button>)}</div> : <p className="mt-4 rounded-xl bg-stone-50 p-4 text-sm text-stone-600">No published consultation times on this date. Choose another date or check back later.</p>}
                {selectedSlot?.isAvailable && !bookingMessage && <div className="mt-4 rounded-xl border border-amber-200 bg-[#fffaf0] p-4"><p className="text-sm font-semibold">Consultation · {new Date(selectedSlot.date).toLocaleDateString()} at {selectedSlot.startTime}</p>{reviewing ? <><p className="mt-1 text-sm text-stone-600">With {selected.name} · {selectedSlot.durationMins || 60} minutes</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => setReviewing(false)} disabled={booking} className="min-h-10 rounded-lg border border-stone-300 px-3 text-sm font-semibold">Back</button><button type="button" onClick={confirmBooking} disabled={booking} className="min-h-10 rounded-lg bg-amber-800 px-4 text-sm font-semibold text-white hover:bg-amber-900 disabled:opacity-60">{booking ? 'Confirming…' : 'Confirm booking'}</button></div></> : <button type="button" onClick={() => setReviewing(true)} className="mt-3 min-h-10 rounded-lg bg-amber-800 px-4 text-sm font-semibold text-white hover:bg-amber-900">Review booking</button>}</div>}
              </section>
              {!assignedPractitioner && !bookingMessage && <button type="button" onClick={() => setAssignmentTarget(selected)} className="min-h-10 rounded-xl border border-amber-300 px-4 text-sm font-semibold text-amber-950 hover:bg-amber-50">Set as my Vaidya</button>}
            </>}
        </div>
      </section>
    </div>}

    {assignmentTarget && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-stone-950/50 p-4"><section role="dialog" aria-modal="true" aria-labelledby="assignment-title" className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"><h2 id="assignment-title" className="text-lg font-semibold">Set your primary Vaidya?</h2><p className="mt-2 text-sm text-stone-600">{assignmentTarget.name} will be saved as your assigned practitioner for your care journey.</p>{assignmentError && <p role="alert" className="mt-3 text-sm text-red-700">{assignmentError}</p>}<div className="mt-5 flex justify-end gap-2"><button type="button" disabled={assignmentSaving} onClick={() => { setAssignmentTarget(null); setAssignmentError(''); }} className="min-h-10 rounded-lg border border-stone-300 px-3 text-sm font-semibold">Cancel</button><button type="button" disabled={assignmentSaving} onClick={confirmAssignment} className="min-h-10 rounded-lg bg-amber-800 px-4 text-sm font-semibold text-white disabled:opacity-50">{assignmentSaving ? 'Saving…' : 'Confirm assignment'}</button></div></section></div>}
  </main>;
}

function Avatar({ practitioner, size = 'normal' }) {
  const [failed, setFailed] = useState(false);
  const dimensions = size === 'large' ? 'h-20 w-20 rounded-2xl' : 'h-14 w-14 rounded-2xl';
  return <div className={`flex shrink-0 items-center justify-center overflow-hidden bg-amber-100 text-amber-800 ${dimensions}`}>{practitioner.profileImageUrl && !failed ? <img src={practitioner.profileImageUrl} alt={`${practitioner.name} profile`} onError={() => setFailed(true)} className="h-full w-full object-cover"/> : <UserRound size={size === 'large' ? 30 : 24}/>}</div>;
}

function PractitionerCard({ practitioner, hasSlotOnDate, isAssigned, onView, onAvailability, onBook }) {
  const therapies = practitioner.practiceAreas || [];
  const address = locationText(practitioner.practiceLocation);
  return <article className={`${card} flex h-full flex-col p-5 transition duration-200 hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-md`}>
    <div className="flex items-start gap-3"><Avatar practitioner={practitioner}/><div className="min-w-0 flex-1"><p className="flex items-center gap-1 text-[11px] font-semibold text-emerald-800"><ShieldCheck size={13}/>Verified</p><h3 className="mt-1 truncate text-lg font-semibold">{practitioner.name}</h3><p className="mt-1 line-clamp-1 text-xs text-stone-600">{practitioner.qualifications?.length ? practitioner.qualifications.join(' · ') : 'Qualifications not listed'}</p></div></div>
    <p className="mt-4 line-clamp-3 min-h-[3.75rem] text-sm leading-5 text-stone-600">{practitioner.bio || 'This Vaidya has not added a professional introduction yet.'}</p>
    <div className="mt-3 space-y-2 text-sm"><div><p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-stone-500">Specializations and therapy expertise</p><TagList items={therapies} empty="No specializations listed." compact/></div>{address && <p className="flex items-start gap-1.5 text-xs text-stone-600"><MapPin size={14} className="mt-0.5 shrink-0 text-amber-800"/><span className="line-clamp-2">{address}</span></p>}<p className="flex items-center gap-1.5 text-xs text-stone-600"><Activity size={14} className="text-amber-800"/>{Number(practitioner.experience) > 0 ? `${practitioner.experience} years of experience` : 'Experience not listed'}</p><p className={`text-xs font-medium ${hasSlotOnDate || practitioner.availabilitySchedule?.some((item) => item.isAvailable) ? 'text-emerald-800' : 'text-stone-500'}`}>{hasSlotOnDate ? 'Consultation slots published for selected date' : practitioner.availabilitySchedule?.some((item) => item.isAvailable) ? 'Weekly working hours published' : 'Check published availability'}</p>{Number(practitioner.consultationFee) > 0 && <p className="text-xs text-stone-600">Consultation fee: ₹{practitioner.consultationFee}</p>}</div>
    <div className="mt-auto grid grid-cols-2 gap-2 pt-5"><button type="button" onClick={onView} className="min-h-10 rounded-xl border border-amber-300 px-3 text-xs font-semibold text-amber-950 transition hover:bg-amber-50">View profile</button><button type="button" onClick={onAvailability} className="min-h-10 rounded-xl border border-stone-300 px-3 text-xs font-semibold text-stone-800 transition hover:bg-stone-50">Availability</button><button type="button" onClick={onBook} className="col-span-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-amber-800 px-3 text-sm font-semibold text-white transition hover:bg-amber-900"><CalendarDays size={16}/>{isAssigned ? 'Book with your Vaidya' : 'Book consultation'}</button></div>
  </article>;
}

function TagList({ items, empty, compact = false }) {
  if (!items?.length) return <p className="text-xs text-stone-500">{empty}</p>;
  return <div className="flex flex-wrap gap-1.5">{items.map((item, index) => <span key={`${item}-${index}`} className={`rounded-full border border-amber-200 bg-[#fffaf0] text-amber-950 ${compact ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1 text-xs'}`}>{item}</span>)}</div>;
}

function DetailBlock({ title, children }) {
  return <section className="rounded-2xl border border-amber-100 bg-white p-4"><h3 className="mb-2 text-sm font-semibold text-stone-900">{title}</h3><div className="text-sm leading-6 text-stone-600">{children}</div></section>;
}
