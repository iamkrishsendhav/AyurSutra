import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  Circle,
  ClipboardCheck,
  HeartHandshake,
  Search,
  UserRound,
} from 'lucide-react';
import authFetch from '../../utils/apiClient';

const cardClass = 'rounded-2xl border border-amber-200/80 bg-white shadow-sm';

const formatDateTime = (date, time) => {
  if (!date) return 'Date to be confirmed';
  const formatted = new Date(date).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
  return time ? `${formatted} · ${time}` : formatted;
};

const getJourneyStatus = (data) => {
  const counts = data?.sessionCounts || {};
  if (data?.approvedPlanCount && counts.planned > 0 && counts.approvedPlanCompleted >= counts.planned) return 'Treatment completed';
  if (data?.activePlan?.status === 'approved') return counts.approvedPlanCompleted > 0 ? 'Treatment in progress' : 'Treatment plan approved';
  if (data?.planStatus === 'pending-approval') return 'Plan awaiting approval';
  if (data?.assessmentCount) return 'Assessment completed';
  if (data?.consultationCounts?.completed) return 'Consultation completed';
  if (data?.upcomingAppointmentCount) return 'Consultation booked';
  if (data?.hasPractitioner) return 'Vaidya selected';
  return 'Journey not started';
};

function SummaryCard({ title, value, hint, icon: Icon, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${cardClass} group min-h-36 p-4 text-left transition duration-200 hover:-translate-y-0.5 hover:border-amber-400 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 sm:p-5`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-stone-600">{title}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-stone-900">{value}</p>
          <p className="mt-1 truncate text-xs text-stone-500">{hint}</p>
        </div>
        <span className="rounded-xl bg-amber-50 p-2.5 text-amber-800"><Icon aria-hidden="true" size={19} /></span>
      </div>
      <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-amber-800">
        View details <ArrowRight size={13} className="transition group-hover:translate-x-0.5" />
      </span>
    </button>
  );
}

function SectionHeading({ eyebrow, title, action, onAction }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-700">{eyebrow}</p>}
        <h2 className="mt-1 text-xl font-semibold tracking-tight text-stone-900">{title}</h2>
      </div>
      {action && <button type="button" onClick={onAction} className="text-sm font-semibold text-amber-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700">{action}</button>}
    </div>
  );
}

function EmptyState({ title, children, action, onAction }) {
  return (
    <div className="rounded-xl bg-[#FFFAF0] p-4 sm:p-5">
      <p className="font-medium text-stone-900">{title}</p>
      <p className="mt-1 text-sm leading-6 text-stone-600">{children}</p>
      {action && <button type="button" onClick={onAction} className="mt-3 inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-amber-800 hover:underline">{action}<ArrowRight size={14} /></button>}
    </div>
  );
}

function StatusPill({ status }) {
  const positive = ['completed', 'confirmed', 'approved'].includes(String(status || '').toLowerCase());
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${positive ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>{String(status || 'scheduled').replaceAll('-', ' ')}</span>;
}

export default function PatientDashboard({ user, notifications = [], onNavigate }) {
  const [data, setData] = useState(null);
  const [profile, setProfile] = useState(user);
  const [loadState, setLoadState] = useState('loading');
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoadState('loading');
    setLoadError('');
    Promise.all([authFetch('/api/profile'), authFetch('/api/dashboard/patient')])
      .then(async ([profileResponse, dashboardResponse]) => {
        const [profileBody, dashboardBody] = await Promise.all([
          profileResponse.json().catch(() => ({})),
          dashboardResponse.json().catch(() => ({})),
        ]);
        if (!profileResponse.ok || !dashboardResponse.ok) {
          throw new Error(profileBody.message || dashboardBody.message || dashboardBody.error || 'Unable to load your care information.');
        }
        if (active) {
          setProfile(profileBody);
          setData(dashboardBody);
          setLoadState('loaded');
        }
      })
      .catch((error) => {
        if (active) {
          setLoadError(error.message || 'Unable to load your dashboard.');
          setLoadState('error');
        }
      });
    return () => { active = false; };
  }, [user?._id, reloadKey]);

  const stages = useMemo(() => {
    const counts = data?.sessionCounts || {};
    return [
      { label: 'Profile completed', done: (data?.profileCompletion || 0) >= 100, tab: 'profile' },
      { label: 'Vaidya selected', done: Boolean(data?.hasPractitioner), tab: 'practitioner-search' },
      { label: 'Consultation booked', done: (data?.consultationCounts?.total || 0) > 0, tab: 'appointments' },
      { label: 'Consultation completed', done: (data?.consultationCounts?.completed || 0) > 0, tab: 'appointments' },
      { label: 'Assessment completed', done: (data?.assessmentCount || 0) > 0, tab: 'treatment-progress' },
      { label: 'Treatment plan approved', done: (data?.approvedPlanCount || 0) > 0, tab: 'treatment-progress' },
      { label: 'Therapy scheduled', done: (counts.approvedPlanGenerated || 0) > 0, tab: 'therapy-schedule' },
      { label: 'Treatment in progress', done: (counts.approvedPlanInProgress || 0) > 0 || (counts.approvedPlanCompleted || 0) > 0, tab: 'treatment-progress' },
      { label: 'Treatment completed', done: Boolean(data?.approvedPlanCount && counts.planned > 0 && counts.approvedPlanCompleted >= counts.planned), tab: 'treatment-progress' },
      { label: 'Follow-up', done: (data?.followUps || []).length > 0, tab: 'follow-ups' },
    ];
  }, [data]);

  if (loadState === 'loading') {
    return (
      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8" role="status" aria-label="Loading patient dashboard">
        <div className="h-40 animate-pulse rounded-3xl bg-amber-100" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 8 }, (_, index) => <div key={index} className="h-36 animate-pulse rounded-2xl bg-amber-100" />)}</div>
        <div className="grid gap-5 lg:grid-cols-2"><div className="h-72 animate-pulse rounded-2xl bg-amber-100" /><div className="h-72 animate-pulse rounded-2xl bg-amber-100" /></div>
      </main>
    );
  }

  if (loadState === 'error') {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <section className={`${cardClass} p-6`} role="alert">
          <h1 className="text-xl font-semibold text-stone-900">Dashboard unavailable</h1>
          <p className="mt-2 text-sm text-stone-600">{loadError}</p>
          <button type="button" onClick={() => setReloadKey((key) => key + 1)} className="mt-4 min-h-10 rounded-lg bg-amber-800 px-4 text-sm font-semibold text-white hover:bg-amber-900">Try again</button>
        </section>
      </main>
    );
  }

  const counts = data?.sessionCounts || {};
  const nextAppointment = data?.nextConsultation;
  const nextTherapy = data?.nextSession;
  const pendingFollowUps = Number(data?.pendingFollowUpCount ?? (data?.followUps || []).filter((item) => item.status === 'pending').length);
  const unreadCount = Number(data?.notifications ?? notifications.filter((item) => !item.read).length);
  const journeyStatus = getJourneyStatus(data);
  const primaryAction = data?.profileCompletion < 100
    ? { label: 'Complete your profile', tab: 'profile', icon: UserRound }
    : !data?.hasPractitioner
      ? { label: 'Find a Vaidya', tab: 'practitioner-search', icon: Search }
      : !data?.consultationCounts?.completed && !data?.upcomingAppointmentCount
        ? { label: 'Book a consultation', tab: 'appointments', icon: CalendarDays }
        : data?.upcomingAppointmentCount
          ? { label: 'View your appointment', tab: 'appointments', icon: CalendarDays }
          : data?.planStatus === 'pending-approval'
          ? { label: 'View treatment update', tab: 'treatment-progress', icon: ClipboardCheck }
          : counts.remaining > 0 && !nextTherapy
            ? { label: 'View therapy schedule', tab: 'therapy-schedule', icon: Activity }
            : pendingFollowUps > 0
              ? { label: 'Review follow-ups', tab: 'follow-ups', icon: HeartHandshake }
              : { label: 'View treatment progress', tab: 'treatment-progress', icon: Activity };
  const PrimaryIcon = primaryAction.icon;
  const latestNotifications = (data?.latestNotifications || notifications).slice(0, 5);
  const metrics = [
    { title: 'Upcoming appointments', value: String(data?.upcomingAppointmentCount || 0), hint: nextAppointment ? `Next ${formatDateTime(nextAppointment.date, nextAppointment.startTime)}` : 'No appointments scheduled', icon: CalendarDays, tab: 'appointments' },
    { title: 'Next therapy session', value: nextTherapy ? formatDateTime(nextTherapy.date, nextTherapy.startTime) : 'Not scheduled', hint: nextTherapy?.therapySnapshot?.name || nextTherapy?.sessionName || 'Your schedule will appear here', icon: Activity, tab: 'therapy-schedule' },
    { title: 'Completed sessions', value: String(data?.completed || 0), hint: 'Therapy sessions completed', icon: ClipboardCheck, tab: 'treatment-progress' },
    { title: 'Total planned sessions', value: String(counts.planned || 0), hint: 'From approved treatment plans', icon: Circle, tab: 'treatment-progress' },
    { title: 'Remaining sessions', value: String(counts.remaining || 0), hint: 'Planned sessions not yet completed', icon: ArrowRight, tab: 'treatment-progress' },
    { title: 'Pending follow-ups', value: String(pendingFollowUps), hint: pendingFollowUps ? 'Open your follow-up details' : 'No follow-ups due', icon: HeartHandshake, tab: 'follow-ups' },
    { title: 'Unread notifications', value: String(unreadCount), hint: 'Care and appointment updates', icon: Bell, tab: 'notifications' },
    { title: 'Profile completion', value: `${data?.profileCompletion || 0}%`, hint: 'Keep your care details up to date', icon: UserRound, tab: 'profile' },
  ];

  return (
    <main className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-6 lg:px-8">
      <section className="rounded-3xl border border-amber-200 bg-gradient-to-br from-[#fffaf0] via-white to-orange-50 p-5 shadow-sm sm:p-7 lg:p-8">
        <div className="flex flex-col justify-between gap-5 md:flex-row md:items-center">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Your AyurSutra care</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">Namaste, {profile?.name || user?.name || 'there'}</h1>
            <p className="mt-2 text-sm leading-6 text-stone-600">Your treatment journey: <strong className="font-semibold text-stone-800">{journeyStatus}</strong></p>
          </div>
          <button type="button" onClick={() => onNavigate?.(primaryAction.tab)} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-amber-800 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 focus-visible:ring-offset-2">
            <PrimaryIcon size={17} />{primaryAction.label}<ArrowRight size={15} />
          </button>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-amber-200/70 pt-4 text-sm">
          <button type="button" onClick={() => onNavigate?.('profile')} className="font-medium text-amber-900 hover:underline">Profile {data?.profileCompletion || 0}% complete</button>
          {data?.activePlan?.status === 'approved' && <span className="text-stone-600">Approved plan: <strong className="font-medium text-stone-800">{data.activePlan.title || 'Treatment plan'}</strong></span>}
          {data?.planStatus === 'pending-approval' && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">Plan awaiting approval</span>}
        </div>
      </section>

      <section aria-label="Patient care statistics" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric) => <SummaryCard key={metric.title} {...metric} onClick={() => onNavigate?.(metric.tab)} />)}
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <section className={`${cardClass} p-4 sm:p-5`}>
          <SectionHeading eyebrow="Patient journey" title="Your care, step by step" action="View progress" onAction={() => onNavigate?.('treatment-progress')} />
          <ol className="mt-4 grid gap-1 sm:grid-cols-2">
            {stages.map((stage, index) => <li key={stage.label}>
              <button type="button" onClick={() => onNavigate?.(stage.tab)} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${stage.done ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-100 text-stone-400'}`}>{stage.done ? <Check size={15} /> : <Circle size={11} />}</span>
                <span className={`text-sm ${stage.done ? 'font-medium text-stone-900' : 'text-stone-500'}`}>{stage.label}</span>
                <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-stone-400">{stage.done ? 'Done' : index === stages.findIndex((item) => !item.done) ? 'Next step' : 'Upcoming'}</span>
              </button>
            </li>)}
          </ol>
        </section>

        <section className={`${cardClass} p-4 sm:p-5`}>
          <SectionHeading eyebrow="Your schedule" title="Upcoming appointments" action="All appointments" onAction={() => onNavigate?.('appointments')} />
          <div className="mt-4 space-y-3">
            {(data?.upcomingAppointments || []).length ? data.upcomingAppointments.slice(0, 3).map((appointment) => <article key={appointment._id} className="rounded-xl bg-[#FFFAF0] p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><p className="font-semibold text-stone-900">{appointment.sessionName || 'Consultation'}</p><p className="mt-1 text-sm text-stone-600">{appointment.practitioner?.name || 'Vaidya'} · {formatDateTime(appointment.date, appointment.startTime)}</p>{appointment.durationMins && <p className="mt-1 text-xs text-stone-500">{appointment.durationMins} minutes</p>}</div>
                <StatusPill status={appointment.status} />
              </div>
              <button type="button" onClick={() => onNavigate?.('appointments')} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-amber-800 hover:underline">View appointment details<ArrowRight size={14} /></button>
            </article>) : <EmptyState title="No upcoming appointments" action={data?.hasPractitioner ? 'Book a consultation' : 'Find a Vaidya'} onAction={() => onNavigate?.(data?.hasPractitioner ? 'appointments' : 'practitioner-search')}>{data?.hasPractitioner ? 'Choose an available consultation slot to meet with your Vaidya.' : 'Find a Vaidya to get started with your care journey.'}</EmptyState>}
          </div>
        </section>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className={`${cardClass} p-4 sm:p-5`}>
          <SectionHeading eyebrow="Panchakarma sessions" title="Upcoming therapy" action="Open schedule" onAction={() => onNavigate?.('therapy-schedule')} />
          {nextTherapy ? <article className="mt-4 rounded-xl bg-orange-50/70 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-lg font-semibold text-stone-900">{nextTherapy.therapySnapshot?.name || nextTherapy.sessionName || nextTherapy.therapyType}</p><p className="mt-1 text-sm text-stone-600">{formatDateTime(nextTherapy.date, nextTherapy.startTime)}</p><p className="mt-1 text-sm text-stone-600">Vaidya: {nextTherapy.practitioner?.name || 'Not assigned'}</p>{nextTherapy.durationMins && <p className="mt-1 text-xs text-stone-500">{nextTherapy.durationMins} minutes</p>}</div><StatusPill status={nextTherapy.status} /></div>
            <button type="button" onClick={() => onNavigate?.('therapy-schedule')} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-amber-800 hover:underline">View therapy schedule<ArrowRight size={14} /></button>
          </article> : <div className="mt-4"><EmptyState title="No therapy session is scheduled" action={data?.activePlan ? 'View approved treatment plan' : 'View treatment progress'} onAction={() => onNavigate?.('treatment-progress')}>{data?.planStatus === 'pending-approval' ? 'Your treatment plan is awaiting approval. Therapy details will appear after approval and scheduling.' : data?.activePlan ? 'Your approved treatment plan is available. Your care team will add sessions to your schedule.' : data?.assessmentCount ? 'Your assessment is recorded. Your Vaidya will prepare an approved treatment plan before therapy begins.' : 'Book a consultation to start the assessment and treatment planning process.'}</EmptyState></div>}
        </section>

        <section className={`${cardClass} p-4 sm:p-5`}>
          <SectionHeading eyebrow="Approved care plan" title="Treatment overview" action="View treatment plan" onAction={() => onNavigate?.('treatment-progress')} />
          {data?.activePlan ? <>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-emerald-50/70 p-4">
              <div><p className="font-semibold text-stone-900">{data.activePlan.title || 'Approved treatment plan'}</p><p className="mt-1 text-sm text-stone-600">Status: <span className="font-medium capitalize text-emerald-800">{data.activePlan.status}</span>{data.activePlan.startDate ? ` · Starts ${new Date(data.activePlan.startDate).toLocaleDateString()}` : ''}</p></div>
              <div className="text-right"><p className="text-xs text-stone-500">Sessions complete</p><p className="text-xl font-semibold text-stone-900">{counts.approvedPlanCompleted || 0}<span className="text-sm font-normal text-stone-500"> / {counts.planned || 0}</span></p></div>
            </div>
            {data.activePlan.therapies?.length ? <div className="mt-3 divide-y divide-amber-100">
              {data.activePlan.therapies.map((therapy, index) => <div key={`${therapy.sessionName}-${index}`} className="py-3">
                <div className="flex items-start justify-between gap-3"><div><p className="font-medium text-stone-900">{therapy.sessionName || therapy.therapyType}</p><p className="mt-1 text-xs text-stone-500">{therapy.phase} phase · {therapy.completedSessions || 0} completed of {therapy.occurrences} planned · {therapy.durationMins} min</p></div><span className="shrink-0 text-xs font-medium text-amber-800">{therapy.frequencyDays ? `Every ${therapy.frequencyDays} days` : ''}</span></div>
                {therapy.instructions && <p className="mt-2 text-sm leading-5 text-stone-600">{therapy.instructions}</p>}
              </div>)}
            </div> : <p className="mt-3 text-sm text-stone-600">Therapy details are not listed on this plan.</p>}
          </> : <div className="mt-4"><EmptyState title="No approved treatment plan yet" action={data?.hasPractitioner ? 'View appointments' : 'Find a Vaidya'} onAction={() => onNavigate?.(data?.hasPractitioner ? 'appointments' : 'practitioner-search')}>{data?.planStatus === 'pending-approval' ? 'Your Vaidya has submitted a plan for approval. Prescribed details will appear here after approval.' : data?.assessmentCount ? 'Your assessment is recorded. Your Vaidya will prepare and approve a plan before sessions are scheduled.' : 'A consultation and assessment are the first steps toward a personalized Panchakarma plan.'}</EmptyState></div>}
        </section>
      </div>

      <section className={`${cardClass} p-4 sm:p-5`}>
        <SectionHeading eyebrow="Care updates" title="Recent notifications" action="View all notifications" onAction={() => onNavigate?.('notifications')} />
        {latestNotifications.length ? <ul className="mt-3 divide-y divide-amber-100">
          {latestNotifications.slice(0, 5).map((notification) => {
            const title = notification.title || notification.payload?.title || String(notification.type || 'Care update').replaceAll('-', ' ');
            const body = notification.message || notification.payload?.body || '';
            const id = notification._id || notification.id;
            return <li key={id || `${title}-${notification.scheduledAt}`}><button type="button" onClick={() => onNavigate?.('notifications')} className="flex min-h-16 w-full items-start gap-3 rounded-lg px-2 py-3 text-left transition hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700">
              <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${notification.read ? 'bg-stone-300' : 'bg-orange-600'}`} aria-label={notification.read ? 'Read' : 'Unread'} />
              <span className="min-w-0 flex-1"><span className="block font-medium capitalize text-stone-900">{title}</span>{body && <span className="mt-0.5 block line-clamp-2 text-sm text-stone-600">{body}</span>}</span>
              <span className="shrink-0 text-xs text-stone-500">{notification.scheduledAt ? new Date(notification.scheduledAt).toLocaleDateString() : ''}</span>
            </button></li>;
          })}
        </ul> : <div className="mt-3"><EmptyState title="You’re all caught up" action="Notification settings" onAction={() => onNavigate?.('notifications')}>New appointment, treatment, and follow-up updates will appear here.</EmptyState></div>}
      </section>

      <section className={`${cardClass} p-4 sm:p-5`}>
        <SectionHeading eyebrow="Quick access" title="Quick actions" />
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ['Find a Vaidya', 'practitioner-search', Search],
            ['Book appointment', 'appointments', CalendarDays],
            ['View treatment plan', 'treatment-progress', ClipboardCheck],
            ['Therapy schedule', 'therapy-schedule', Activity],
            ['Update profile', 'profile', UserRound],
          ].map(([label, tab, Icon]) => <button key={tab} type="button" onClick={() => onNavigate?.(tab)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-amber-200 bg-[#FFFCF6] px-3 text-sm font-semibold text-amber-900 transition hover:border-amber-400 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700"><Icon size={16} />{label}</button>)}
        </div>
      </section>
    </main>
  );
}
