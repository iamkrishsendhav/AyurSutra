import React, { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const keyFor = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const parseKey = (value) => new Date(`${value}T12:00:00`);
const shiftDays = (value, days) => {
  const date = parseKey(value);
  date.setDate(date.getDate() + days);
  return keyFor(date);
};
const startOfWeek = (value) => {
  const date = parseKey(value);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return keyFor(date);
};
const appointmentKey = (value) => new Date(value).toISOString().slice(0, 10);

export default function ReceptionistAppointmentCalendar({ appointments = [], date, mode, onDateChange, onModeChange, today }) {
  const anchor = parseKey(date);
  const days = useMemo(() => {
    if (mode === 'day') return [date];
    if (mode === 'week') return Array.from({ length: 7 }, (_, index) => shiftDays(startOfWeek(date), index));
    const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12);
    const gridStart = startOfWeek(keyFor(monthStart));
    return Array.from({ length: 42 }, (_, index) => shiftDays(gridStart, index));
  }, [anchor, date, mode]);
  const byDay = useMemo(() => {
    const grouped = new Map();
    for (const appointment of appointments) {
      const key = appointmentKey(appointment.date);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(appointment);
    }
    return grouped;
  }, [appointments]);
  const move = (amount) => {
    if (mode === 'day') return onDateChange(shiftDays(date, amount));
    if (mode === 'week') return onDateChange(shiftDays(date, amount * 7));
    const target = new Date(anchor.getFullYear(), anchor.getMonth() + amount, 1, 12);
    onDateChange(keyFor(target));
  };
  const label = mode === 'month'
    ? anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : mode === 'week'
      ? `${new Date(`${days[0]}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${new Date(`${days[6]}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
      : anchor.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const selectDay = (day) => { onDateChange(day); onModeChange('day'); };
  const renderAppointments = (day, compact = false, limit = Infinity) => (byDay.get(day) || []).slice(0, limit).map((appointment) => (
    <button key={appointment._id} type="button" onClick={() => selectDay(day)} title={`${appointment.startTime} · ${appointment.patient?.name || 'Patient'} · ${appointment.status}`} className={`block w-full truncate rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-left text-xs text-amber-950 hover:border-amber-400 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 ${compact ? 'mt-1' : 'mt-2'}`}>
      <span className="font-semibold">{appointment.startTime}</span> {appointment.patient?.name || 'Patient'}
    </button>
  ));

  return <section className="rounded-2xl border border-amber-200 bg-white p-4 shadow-sm sm:p-5" aria-label={`${mode} appointment calendar`}>
    <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Calendar</p><h3 className="mt-1 font-semibold text-amber-950">{label}</h3></div>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Calendar period" className="flex rounded-lg border border-amber-200 bg-amber-50 p-1">{[['day', 'Day'], ['week', 'Week'], ['month', 'Month']].map(([value, text]) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => onModeChange(value)} className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${mode === value ? 'bg-amber-800 text-white' : 'text-amber-900 hover:bg-white'}`}>{text}</button>)}</div>
        <button type="button" onClick={() => move(-1)} aria-label="Previous calendar period" className="rounded-lg border border-amber-200 p-2 text-amber-900 hover:bg-amber-50"><ChevronLeft className="h-4 w-4"/></button>
        <button type="button" onClick={() => onDateChange(today)} className="rounded-lg border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-50">Today</button>
        <button type="button" onClick={() => move(1)} aria-label="Next calendar period" className="rounded-lg border border-amber-200 p-2 text-amber-900 hover:bg-amber-50"><ChevronRight className="h-4 w-4"/></button>
      </div>
    </header>
    {mode === 'day' ? <div className="space-y-2">{(byDay.get(date) || []).length ? renderAppointments(date) : <p className="rounded-xl border border-dashed border-amber-300 bg-amber-50/50 p-6 text-center text-sm text-amber-800">No appointments for this day.</p>}</div> : <div className="overflow-x-auto">
      <div className={`grid min-w-[46rem] grid-cols-7 ${mode === 'month' ? 'gap-px overflow-hidden rounded-xl border border-amber-100 bg-amber-100' : 'gap-2'}`}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((weekday) => <div key={weekday} className="bg-amber-50 px-2 py-2 text-center text-xs font-semibold text-amber-800">{weekday}</div>)}
        {days.map((day) => {
          const dayDate = parseKey(day);
          const inMonth = dayDate.getMonth() === anchor.getMonth();
          const selected = day === date;
          const cellClass = mode === 'month' ? 'min-h-24 bg-white p-1.5 sm:min-h-28' : 'min-h-48 rounded-xl border border-amber-100 bg-white p-2';
          return <div key={day} className={`${cellClass} ${mode === 'month' && !inMonth ? 'bg-stone-50 text-stone-400' : ''} ${selected ? 'ring-2 ring-inset ring-amber-600' : ''}`}>
            <button type="button" onClick={() => selectDay(day)} aria-label={`Show appointments for ${day}`} className={`flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-xs font-semibold hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 ${day === today ? 'bg-amber-800 text-white hover:bg-amber-900' : ''}`}>{dayDate.getDate()}</button>
            {renderAppointments(day, true, mode === 'month' ? 3 : Infinity)}
            {mode === 'month' && (byDay.get(day) || []).length > 3 && <p className="mt-1 px-1 text-[10px] text-amber-700">+{byDay.get(day).length - 3} more</p>}
          </div>;
        })}
      </div>
    </div>}
  </section>;
}
