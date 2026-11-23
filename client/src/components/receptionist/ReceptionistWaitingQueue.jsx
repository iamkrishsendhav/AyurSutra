import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, Megaphone } from 'lucide-react';

const appointmentStart = (appointment) => {
  const day = new Date(appointment.date).toISOString().slice(0, 10);
  return new Date(`${day}T${appointment.startTime || '00:00'}:00`);
};

export default function ReceptionistWaitingQueue({ appointments = [], onCallNext }) {
  const [, setClock] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setClock((value) => value + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  const { queue, tokens } = useMemo(() => {
    const checkedIn = appointments.filter((item) => item.checkedInAt)
      .sort((left, right) => new Date(left.checkedInAt) - new Date(right.checkedInAt) || String(left._id).localeCompare(String(right._id)));
    return {
      tokens: new Map(checkedIn.map((item, index) => [String(item._id), index + 1])),
      queue: checkedIn.filter((item) => ['scheduled', 'confirmed'].includes(item.status)),
    };
  }, [appointments]);
  const nextToCall = queue.find((item) => !item.queueCalledAt);
  const waitingCount = queue.filter((item) => !item.queueCalledAt).length;

  return <section className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm" aria-labelledby="receptionist-waiting-queue-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Live check-in</p><h2 id="receptionist-waiting-queue-title" className="mt-1 font-semibold text-amber-950">Waiting queue</h2><p className="mt-1 text-xs text-amber-700">Tokens follow check-in order. Queue updates when visits are called, cancelled or completed.</p></div><span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">{waitingCount} waiting · {queue.length - waitingCount} called</span></div>
    {queue.length ? <ol className="mt-4 space-y-2">{queue.map((item, index) => {
      const waitingMins = Math.max(0, Math.floor((Date.now() - new Date(item.checkedInAt).getTime()) / 60000));
      const delayMins = Math.max(0, Math.floor((Date.now() - appointmentStart(item).getTime()) / 60000));
      const delayed = !item.queueCalledAt && delayMins >= 15;
      return <li key={item._id} className={`rounded-xl border p-3 ${item.queueCalledAt ? 'border-emerald-200 bg-emerald-50/60' : index === 0 ? 'border-amber-300 bg-amber-50/70' : 'border-amber-100 bg-white'}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex min-w-0 items-start gap-3"><span aria-label={`Queue token ${tokens.get(String(item._id))}`} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-800 text-sm font-bold text-white">{tokens.get(String(item._id))}</span><div className="min-w-0"><p className="truncate font-semibold text-amber-950">{item.patient?.name || 'Patient'}</p><p className="text-sm text-amber-800">{item.startTime} · {item.sessionName || item.therapyType} · {item.practitioner?.name || 'Vaidya unassigned'}</p><p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-600"><span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5"/>Waiting {waitingMins} min</span><span className="capitalize">{item.status.replace('-', ' ')}</span>{delayed && <span className="font-semibold text-orange-800">Running {delayMins} min late</span>}{item.queueCalledAt && <span className="font-semibold text-emerald-800">Called {new Date(item.queueCalledAt).toLocaleTimeString()}</span>}</p></div></div>
          {item.queueCalledAt ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800"><CheckCircle2 className="h-4 w-4"/>Called</span> : item._id === nextToCall?._id ? <button type="button" onClick={() => onCallNext(item._id)} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-amber-800 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"><Megaphone className="h-4 w-4"/>Call next</button> : <span className="text-xs text-amber-700">In queue</span>}
        </div>
      </li>;
    })}</ol> : <p className="mt-4 rounded-xl border border-dashed border-amber-300 bg-amber-50/50 p-5 text-center text-sm text-amber-800">No checked-in patients are waiting.</p>}
  </section>;
}
