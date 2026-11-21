import React from "react";
import { Layout, Calendar, Bell, TrendingUp, User, Search, Users, Shield, ClipboardList, BookOpen, Stethoscope, FileBarChart, HeartHandshake, Clock } from "lucide-react";

const Navigation = ({ activeTab, setActiveTab, userType }) => {
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
          ? [baseTabs[0], { id: 'reception-patients', label: 'Patients', icon: Users }, { id: 'reception-appointments', label: 'Appointments & Booking', icon: Calendar }, { id: 'reception-checkin', label: 'Check-in / Queue', icon: ClipboardList }, { id: 'reception-availability', label: 'Vaidya Schedule', icon: Stethoscope }, { id: 'notifications', label: 'Notifications', icon: Bell }, { id: 'profile', label: 'My Profile', icon: User }]
        : userType === 'admin'
        ? [baseTabs[0], baseTabs[2], baseTabs[4]]
        : baseTabs;

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
