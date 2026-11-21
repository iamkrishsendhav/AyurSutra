import React from 'react';

const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export default function AvailabilityEditor({ value = [], onChange, disabled = false }) {
  const schedule = Array.isArray(value) ? value : [];
  const setDay = (dayOfWeek, patch) => {
    const existing = schedule.find((day) => day.dayOfWeek === dayOfWeek) || { dayOfWeek, startTime: '09:00', endTime: '17:00', isAvailable: false };
    const next = { ...existing, ...patch };
    const others = schedule.filter((day) => day.dayOfWeek !== dayOfWeek);
    onChange(next.isAvailable ? [...others, next].sort((a, b) => weekdays.indexOf(a.dayOfWeek) - weekdays.indexOf(b.dayOfWeek)) : others);
  };

  return <div className="space-y-2">
    {weekdays.map((dayOfWeek) => {
      const entry = schedule.find((day) => day.dayOfWeek === dayOfWeek);
      const active = Boolean(entry?.isAvailable);
      return <div key={dayOfWeek} className="grid grid-cols-1 gap-2 rounded-lg border border-amber-100 bg-white/70 p-3 sm:grid-cols-[1fr_1fr_1fr] sm:items-center">
        <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={active} disabled={disabled} onChange={(event) => setDay(dayOfWeek, { isAvailable: event.target.checked })} />{dayOfWeek}</label>
        <label className="text-xs text-gray-600">Start<input type="time" value={entry?.startTime || '09:00'} disabled={disabled || !active} onChange={(event) => setDay(dayOfWeek, { startTime: event.target.value })} className="mt-1 block w-full rounded border border-amber-200 p-2 text-sm" /></label>
        <label className="text-xs text-gray-600">End<input type="time" value={entry?.endTime || '17:00'} disabled={disabled || !active} onChange={(event) => setDay(dayOfWeek, { endTime: event.target.value })} className="mt-1 block w-full rounded border border-amber-200 p-2 text-sm" /></label>
      </div>;
    })}
  </div>;
}
