import React, { useMemo } from 'react';
import { CalendarDays, Clock3, Stethoscope } from 'lucide-react';

const weekDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function ReceptionistVaidyaSchedule({ practitioners = [], appointments = [], selectedDate }) {
  const selectedWeekday = useMemo(() => weekDays[new Date(`${selectedDate}T12:00:00`).getDay()], [selectedDate]);
  const workload = useMemo(() => {
    const counts = new Map();
    for (const item of appointments) {
      if (new Date(item.date).toISOString().slice(0, 10) !== selectedDate) continue;
      const practitionerId = item.practitioner?._id || item.practitioner;
      if (practitionerId && item.status !== 'cancelled') counts.set(String(practitionerId), (counts.get(String(practitionerId)) || 0) + 1);
    }
    return counts;
  }, [appointments, selectedDate]);

  return <section id="receptionist-availability" className="scroll-mt-6 rounded-2xl border border-amber-200 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="receptionist-vaidya-schedule-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Care team coordination</p><h2 id="receptionist-vaidya-schedule-title" className="mt-1 text-lg font-semibold text-amber-950">Vaidya schedule &amp; workload</h2><p className="mt-1 text-sm text-amber-800">Verified active practitioners only. Availability comes from each Vaidya’s published working hours.</p></div><span className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900"><CalendarDays className="h-4 w-4"/>{new Date(`${selectedDate}T12:00:00`).toLocaleDateString()}</span></div>
    {practitioners.length ? <div className="mt-4 grid gap-3 md:grid-cols-2">{practitioners.map((person) => {
      const schedule = (person.availabilitySchedule || []).filter((item) => item.dayOfWeek === selectedWeekday && item.isAvailable !== false);
      return <article key={person._id} className="rounded-xl border border-amber-100 bg-amber-50/40 p-4"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><span className="rounded-xl bg-white p-2 text-amber-800"><Stethoscope className="h-5 w-5"/></span><div className="min-w-0"><h3 className="truncate font-semibold text-amber-950">{person.name}</h3><p className="mt-0.5 text-xs text-amber-700">{person.practiceAreas?.join(' · ') || 'General practice'}</p></div></div><span className="shrink-0 rounded-full border border-amber-200 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900">{workload.get(String(person._id)) || 0} visits</span></div><div className="mt-3 border-t border-amber-100 pt-3">{schedule.length ? <ul className="space-y-1.5">{schedule.map((entry, index) => <li key={`${entry.startTime}-${index}`} className="flex items-center gap-2 text-sm text-amber-900"><Clock3 className="h-4 w-4 text-amber-700"/>{entry.startTime}–{entry.endTime}</li>)}</ul> : <p className="text-sm text-stone-600">No published working hours for {selectedWeekday}.</p>}</div></article>;
    })}</div> : <p className="mt-4 rounded-xl border border-dashed border-amber-300 bg-amber-50/50 p-6 text-center text-sm text-amber-800">No verified Vaidyas are available to display.</p>}
  </section>;
}
