import React, { useState } from "react";
import { Layout, Calendar, Bell, TrendingUp, User, Search, Users, Shield, ClipboardList, BookOpen, Stethoscope, FileBarChart, HeartHandshake, Clock, ChevronLeft, ChevronRight } from "lucide-react";

const Navigation = ({ activeTab, setActiveTab, userType }) => {
  const [collapsed, setCollapsed] = useState(false);
  const baseTabs = [
    { id: "dashboard", label: "Dashboard", icon: Layout },
    { id: "scheduling", label: "Therapy Scheduling", icon: Calendar },
    { id: "notifications", label: "Notifications & Care", icon: Bell },
    { id: "progress", label: "Progress Tracking", icon: TrendingUp },
    { id: "profile", label: "My Profile", icon: User },
  ];

  // Add practitioner search for patients
  const tabs = userType === 'patient'
    ? [baseTabs[0], { id: 'profile', label: 'My Profile', icon: User }, { id: 'practitioner-search', label: 'Find Vaidya', icon: Search }, { id: 'appointments', label: 'Appointments', icon: Calendar }, { id: 'therapy-schedule', label: 'Therapy Schedule', icon: ClipboardList }, { id: 'treatment-progress', label: 'Treatment Progress', icon: TrendingUp }, { id: 'follow-ups', label: 'Follow-ups', icon: HeartHandshake }, { id: 'notifications', label: 'Notifications', icon: Bell }]
    : userType === 'practitioner'
      ? [baseTabs[0], { id: "practitioner-patients", label: "My Patients", icon: Users }, { id: 'session-operations', label: 'Therapy Schedule', icon: ClipboardList }, { id: 'progress', label: 'Treatment Progress', icon: TrendingUp }, { id: 'practitioner-follow-ups', label: 'Follow-ups', icon: HeartHandshake }, { id: 'therapy-catalogue', label: 'Therapy Catalogue', icon: BookOpen }, { id: 'practitioner-availability', label: 'My Availability', icon: Clock }, { id: 'notifications', label: 'Notifications', icon: Bell }, { id: 'profile', label: 'My Profile', icon: User }]
        : userType === 'receptionist'
          ? [baseTabs[0], { id: 'reception-patients', label: 'Patients', icon: Users }, { id: 'reception-appointments', label: 'Appointments & Booking', icon: Calendar }, { id: 'reception-therapy-scheduling', label: 'Therapy Assignment', icon: Calendar }, { id: 'reception-checkin', label: 'Check-in / Queue', icon: ClipboardList }, { id: 'reception-availability', label: 'Vaidya Schedule', icon: Stethoscope }, { id: 'notifications', label: 'Notifications', icon: Bell }, { id: 'profile', label: 'My Profile', icon: User }]
        : userType === 'admin'
        ? [baseTabs[0], baseTabs[2], baseTabs[4]]
        : baseTabs;

  if (userType === 'receptionist') {
    const receptionistTabs = [
      { id: 'dashboard', label: 'Overview', icon: Layout },
      { id: 'reception-patients', label: 'Patients', icon: Users },
      { id: 'reception-appointments', label: 'Appointments', icon: Calendar },
      { id: 'reception-therapy-scheduling', label: 'Therapy assignment', icon: ClipboardList },
      { id: 'reception-checkin', label: 'Check-in & queue', icon: Clock },
      { id: 'reception-availability', label: 'Vaidya schedule', icon: Stethoscope },
      { id: 'reception-reports', label: 'Reports', icon: FileBarChart },
      { id: 'notifications', label: 'Notifications', icon: Bell },
      { id: 'profile', label: 'My profile', icon: User },
    ];
    return <>
      <nav aria-label="Reception workspace navigation" className="horizontal-scroll mb-4 overflow-x-auto rounded-xl lg:hidden">
        <div className="as-tabbar">{receptionistTabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => setActiveTab(id)} aria-current={activeTab === id ? 'page' : undefined} className="as-nav-tab"><Icon aria-hidden="true" className="h-4 w-4 shrink-0"/>{label}</button>)}</div>
      </nav>
      <aside className={`hidden shrink-0 transition-[width] duration-200 lg:sticky lg:top-4 lg:block ${collapsed ? 'lg:w-[4.5rem]' : 'lg:w-60'}`}>
        <div className="rounded-2xl border border-amber-200 bg-white/90 p-2 shadow-sm">
          <div className={`flex items-center gap-2 px-2 py-3 ${collapsed ? 'justify-center' : 'justify-between'}`}>
            {!collapsed && <div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700">Clinic operations</p><p className="mt-0.5 text-sm font-semibold text-amber-950">Reception desk</p></div>}
            <button type="button" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? 'Expand reception navigation' : 'Collapse reception navigation'} aria-expanded={!collapsed} className="rounded-lg p-2 text-amber-800 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600">{collapsed ? <ChevronRight className="h-4 w-4"/> : <ChevronLeft className="h-4 w-4"/>}</button>
          </div>
          <div className="space-y-1">{receptionistTabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => setActiveTab(id)} aria-current={activeTab === id ? 'page' : undefined} title={collapsed ? label : undefined} className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 ${activeTab === id ? 'bg-amber-700 font-semibold text-white shadow-sm' : 'text-amber-900 hover:bg-amber-50'}`}><Icon aria-hidden="true" className="h-4 w-4 shrink-0"/><span className={collapsed ? 'sr-only' : 'truncate'}>{label}</span></button>)}</div>
        </div>
      </aside>
    </>;
  }

  return (
    <nav aria-label="Main navigation" className="w-full bg-[#FDF7E9] py-3">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="horizontal-scroll overflow-x-auto rounded-xl">
          <div className="as-tabbar">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                type="button"
                aria-current={activeTab === tab.id ? 'page' : undefined}
                className="as-nav-tab"
              >
                <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                {tab.label}
              </button>
            );
          })}
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navigation;
