import React, { useEffect, useState } from "react";
import authFetch from "../../utils/apiClient";
import { User, MapPin, Phone, Calendar, ArrowRight, CheckCircle, AlertCircle } from "lucide-react";
import NotificationsPanel from "../NotificationsPanel";

// Import background patterns
const cornerMandala = "/patterns/corner-mandala.svg";
const lotusBackground = "/patterns/lotus-bg.svg";
const mandalaBackground = "/patterns/mandala-bg.svg";
const herbsBackground = "/patterns/herbs-bg.svg";

const PatientDashboard = ({ user, patientProgress, notifications, onNavigate }) => {
  const [data, setData] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loadState, setLoadState] = useState("loading");

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [profileResponse, dashboardResponse] = await Promise.all([
          authFetch("/api/profile"),
          authFetch("/api/dashboard/patient"),
        ]);
        if (profileResponse.status === 401 || dashboardResponse.status === 401) {
          localStorage.removeItem("token");
          throw new Error("unauthorized");
        }
        if (!profileResponse.ok || !dashboardResponse.ok) throw new Error("request_failed");
        const [profileData, dashboardData] = await Promise.all([profileResponse.json(), dashboardResponse.json()]);
        if (active) { setProfile(profileData); setData(dashboardData); setLoadState("loaded"); }
      } catch {
        if (active) setLoadState("error");
      }
    };
    load();
    return () => { active = false; };
  }, []);

  return (
    <div className="as-page w-full">
      {/* Main Container */}
      <div className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-6 lg:px-8">
        {/* Background Decorations */}
        <div className="fixed top-0 right-0 w-32 h-32 opacity-10 pointer-events-none">
          <img src={cornerMandala} alt="" className="w-full h-full" />
        </div>
        <div className="fixed bottom-0 left-0 w-64 h-64 opacity-5 pointer-events-none">
          <img src={lotusBackground} alt="" className="w-full h-full" />
        </div>

        {/* Welcome Card */}
        <section className="relative overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-5 shadow-sm sm:p-7">
          <div className="absolute top-0 right-0 w-32 h-32 opacity-5">
            <img src={mandalaBackground} alt="" className="w-full h-full" />
          </div>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-amber-950 sm:text-3xl">
                {loadState === "loading" ? "Loading your profile…" : loadState === "loaded" ? `Namaste, ${profile?.name || "Patient"}` : "Unable to load your profile"}
              </h1>
              <p className="text-amber-700 mt-2">{profile?.email || (loadState === "error" ? "Your session may have expired. Please sign in again." : "Continue your path to wellness and balance.")}</p>
            </div>
            <div className="sm:min-w-28 sm:text-right">
              <div className="relative">
                <span className="text-4xl font-bold text-amber-600">
                  {data?.progress == null ? '—' : `${data.progress}%`}
                </span>
                <div className="absolute -top-3 -right-3 w-20 h-20 opacity-10">
                  <img src={herbsBackground} alt="" className="w-full h-full" />
                </div>
              </div>
              <p className="text-sm text-amber-700">Journey Progress</p>
            </div>
          </div>
        </section>

        {/* Practitioner Assignment Section */}
        {loadState === 'loaded' && !data?.hasPractitioner && (
          <section className="relative overflow-hidden rounded-2xl border border-amber-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="absolute top-0 right-0 w-32 h-32 opacity-5">
              <img src={mandalaBackground} alt="" className="w-full h-full" />
            </div>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3 sm:items-center">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-100">
                  <AlertCircle className="h-6 w-6 text-amber-700" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-amber-950">No Practitioner Assigned</h2>
                  <p className="mt-1 text-sm leading-6 text-amber-800">Find and assign a practitioner to get started with your treatment journey.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onNavigate?.('practitioner-search')}
                className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-amber-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-800"
              >
                Find Practitioner
                <ArrowRight className="h-4 w-4 ml-2" />
              </button>
            </div>
          </section>
        )}

        {data?.hasPractitioner && data?.assignedPractitioner && (
          <section className="relative overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5 shadow-sm sm:p-6">
            <div className="absolute top-0 right-0 w-32 h-32 opacity-5">
              <img src={mandalaBackground} alt="" className="w-full h-full" />
            </div>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3 sm:items-center">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                  <CheckCircle className="h-6 w-6 text-green-600" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-emerald-950">Assigned to Dr. {data.assignedPractitioner.name}</h2>
                  <div className="flex items-center text-green-700 text-sm mt-1">
                    <MapPin className="h-4 w-4 mr-1" />
                    {data.assignedPractitioner.practiceLocation?.city}, {data.assignedPractitioner.practiceLocation?.state}
                  </div>
                  {data.assignedPractitioner.practiceAreas && data.assignedPractitioner.practiceAreas.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {data.assignedPractitioner.practiceAreas.slice(0, 2).map((area, index) => (
                        <span key={index} className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full">
                          {area}
                        </span>
                      ))}
                      {data.assignedPractitioner.practiceAreas.length > 2 && (
                        <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full">
                          +{data.assignedPractitioner.practiceAreas.length - 2} more
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onNavigate?.('practitioner-search')}
                className="min-h-10 shrink-0 rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-800"
              >
                View Details
              </button>
            </div>
          </section>
        )}

        {/* Quick Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-gradient-to-br from-amber-50 to-orange-50 p-4 rounded-xl shadow-sm border border-amber-100 relative overflow-hidden group hover:shadow-md transition-all">
            <div className="absolute top-0 right-0 w-16 h-16 opacity-5 group-hover:opacity-10 transition-opacity">
              <img src={mandalaBackground} alt="" className="w-full h-full" />
            </div>
            <p className="text-amber-800 mb-2 font-medium">
              Next Healing Session
            </p>
            <p className="text-xl font-semibold text-amber-900">
              {data?.nextSession ? `${new Date(data.nextSession.date).toLocaleDateString()} ${data.nextSession.startTime || ''}` : "Not Scheduled"}
            </p>
          </div>
          <div className="bg-gradient-to-br from-amber-50 to-orange-50 p-6 rounded-xl shadow-md border border-amber-100 relative overflow-hidden group hover:shadow-lg transition-all">
            <div className="absolute top-0 right-0 w-16 h-16 opacity-5 group-hover:opacity-10 transition-opacity">
              <img src={mandalaBackground} alt="" className="w-full h-full" />
            </div>
            <p className="text-amber-800 mb-2 font-medium">
              Sessions Completed
            </p>
            <p className="text-xl font-semibold text-amber-900">
              {data?.completed || 0}/{data?.total || 0}
            </p>
          </div>
          <div className="bg-gradient-to-br from-amber-50 to-orange-50 p-6 rounded-xl shadow-md border border-amber-100 relative overflow-hidden group hover:shadow-lg transition-all">
            <div className="absolute top-0 right-0 w-16 h-16 opacity-5 group-hover:opacity-10 transition-opacity">
              <img src={mandalaBackground} alt="" className="w-full h-full" />
            </div>
            <p className="text-amber-800 mb-2 font-medium">
              Unread Messages
            </p>
            <p className="text-xl font-semibold text-amber-900">
              {data?.unreadMessages ?? 0}
            </p>
          </div>
          <div className="bg-gradient-to-br from-amber-50 to-orange-50 p-6 rounded-xl shadow-md border border-amber-100 relative overflow-hidden group hover:shadow-lg transition-all">
            <div className="absolute top-0 right-0 w-16 h-16 opacity-5 group-hover:opacity-10 transition-opacity">
              <img src={mandalaBackground} alt="" className="w-full h-full" />
            </div>
            <p className="text-amber-800 mb-2 font-medium">Profile Completion</p>
            <p className="text-xl font-semibold text-amber-900">{data?.profileCompletion ?? 0}%</p>
            <p className="mt-1 text-xs text-amber-800">Based on key profile details</p>
          </div>
        </div>

        <section className="rounded-xl border border-amber-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold text-amber-950">Upcoming therapy sessions</h2><button type="button" onClick={() => onNavigate?.('therapy-schedule')} className="text-sm font-medium text-amber-800 underline">Open schedule</button></div>
          {data?.upcomingSessions?.length ? <div className="mt-3 divide-y divide-amber-100">{data.upcomingSessions.map((session) => <div key={session._id} className="flex flex-wrap items-center justify-between gap-2 py-3"><div><p className="font-medium text-amber-950">{session.therapySnapshot?.name || session.sessionName || session.therapyType}</p><p className="text-sm text-stone-600">{new Date(session.date).toLocaleDateString()} · {session.startTime} · {session.durationMins || 60} min</p></div><span className="rounded-full bg-amber-100 px-3 py-1 text-xs capitalize">{session.status}</span></div>)}</div> : <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-stone-700">{data?.activePlan?.status === 'approved' ? 'Your plan is approved, but sessions have not been generated yet.' : data?.activePlan?.status === 'pending-approval' ? 'Your treatment plan is waiting for clinician approval.' : data?.assessmentCount ? 'Your Vaidya will prepare a treatment plan before therapy sessions appear.' : 'Book a consultation to begin your treatment journey.'}</p>}
        </section>

        <section className="rounded-xl border border-amber-200 bg-white p-4 shadow-sm sm:p-5">
          <h2 className="text-lg font-semibold text-amber-950">Quick actions</h2>
          <div className="mt-3 flex flex-wrap gap-2">{[['practitioner-search','Find a Vaidya'],['appointments','Book consultation'],['therapy-schedule','Therapy schedule'],['treatment-progress','Treatment progress'],['profile','Update health profile']].map(([tab,label]) => <button key={tab} type="button" onClick={() => onNavigate?.(tab)} className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100">{label}</button>)}</div>
        </section>

        {/* Therapy Progress and Wellness */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-gradient-to-br from-amber-50 to-orange-50 p-6 rounded-xl shadow-sm border border-amber-100 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 opacity-5">
              <img src={lotusBackground} alt="" className="w-full h-full" />
            </div>
            <h3 className="text-xl font-semibold text-amber-900 mb-6">
              Your Healing Journey
            </h3>
            <div className="w-full bg-amber-200/30 rounded-full h-4 mb-4 overflow-hidden">
              <div
                className="bg-gradient-to-r from-amber-400 to-orange-400 h-4 rounded-full transition-all duration-500"
                style={{ width: `${data?.progress || 0}%` }}
              ></div>
            </div>
            <p className="text-amber-800 mb-2">
              Overall Progress{" "}
              <span className="font-semibold text-amber-900">
                {data?.progress == null ? 'Not started' : `${data.progress}%`}
              </span>
            </p>
            <p className="text-amber-700">Generated therapy sessions: <span className="font-medium">{data?.sessionCounts?.generated ?? 0}</span> · Planned: <span className="font-medium">{data?.sessionCounts?.planned ?? 0}</span> · Cancelled: <span className="font-medium">{data?.sessionCounts?.cancelled ?? 0}</span></p>
          </div>

          {/* Dosha Balance & Wellness */}
          <div className="bg-gradient-to-br from-amber-50 to-orange-50 p-8 rounded-xl shadow-md border border-amber-100 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 opacity-5">
              <img src={herbsBackground} alt="" className="w-full h-full" />
            </div>
            <h3 className="text-xl font-semibold text-amber-900 mb-6">
              Treatment Plan
            </h3>
            {data?.activePlan ? <><p className="text-amber-800">Status: <span className="font-semibold capitalize">{data.activePlan.status.replace('-', ' ')}</span></p><p className="mt-2 text-sm text-amber-800">{data.activePlan.therapies?.map((therapy) => therapy.therapyType).filter(Boolean).join(' · ') || 'Therapy details are being prepared.'}</p>{data.activePlan.status === 'approved' && !data.sessionCounts?.generated && <p className="mt-2 text-sm text-amber-700">Approved plan · sessions not generated yet.</p>}</> : <p className="text-amber-700">{data?.assessmentCount ? 'Your assessment is recorded. Your Vaidya will prepare your treatment plan.' : 'No assessment is recorded yet. Book a consultation to get started.'}</p>}
          </div>
        </div>

        {/* Notifications & Care */}
        {data?.nextConsultation && <section className="rounded-xl border border-amber-200 bg-white p-4"><h2 className="font-semibold text-amber-950">Upcoming consultation</h2><p className="mt-1 text-sm text-amber-800">{new Date(data.nextConsultation.date).toLocaleDateString()} · {data.nextConsultation.startTime} · {data.nextConsultation.practitioner?.name || 'Vaidya'}</p><button type="button" onClick={() => onNavigate?.('appointments')} className="mt-2 text-sm font-medium text-amber-800 underline">View appointments</button></section>}
        {data?.sessionCounts?.remainingToGenerate > 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Your approved plan has {data.sessionCounts.remainingToGenerate} planned session(s) not yet generated. Contact your Vaidya for scheduling.</p>}
        {data?.followUps?.length > 0 && <section className="rounded-xl border border-amber-200 bg-white p-4"><h2 className="font-semibold text-amber-950">Next follow-up</h2><p className="mt-1 text-sm text-amber-800">{new Date(data.followUps.find((item) => item.status === 'pending')?.dueAt || data.followUps[0].dueAt).toLocaleDateString()} · {data.followUps.find((item) => item.status === 'pending')?.practitioner?.name || data.followUps[0].practitioner?.name || 'Vaidya'}</p><button type="button" onClick={() => onNavigate?.('follow-ups')} className="mt-2 text-sm font-medium text-amber-800 underline">View follow-ups</button></section>}
        <div className="grid grid-cols-1 gap-4">
          <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl shadow-sm border border-amber-100 overflow-hidden">
            <div className="relative">
              <div className="absolute top-0 right-0 w-32 h-32 opacity-5">
                <img src={mandalaBackground} alt="" className="w-full h-full" />
              </div>
              <NotificationsPanel
                userEmail={user?.email}
                currentUserId={user?._id}
                userType={user?.userType}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PatientDashboard;
