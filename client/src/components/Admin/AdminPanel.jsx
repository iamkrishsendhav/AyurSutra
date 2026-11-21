import React, { useState } from 'react';
import { Shield, MessageSquare, Users, Settings, CheckCircle, Clock, XCircle, Stethoscope, BookOpen, LayoutDashboard, CalendarDays, ClipboardList, Bell, MessageSquareText, Activity, FileBarChart } from 'lucide-react';
import WhatsAppTester from './WhatsAppTester';
import VerificationPanel from './VerificationPanel';
import AdminPatientManagement from './AdminPatientManagement';
import AdminPractitionerManagement from './AdminPractitionerManagement';
import TherapyCatalogue from '../TherapyCatalogue';
import { AdminOverview, AdminAppointments, AdminPlans, AdminFollowUps, AdminFeedback, AdminActivity, AdminSettings } from './AdminOperations';
import AdminReports from './AdminReports';
import AdminStaffManagement from './AdminStaffManagement';

const AdminPanel = ({ user, initialTab = 'overview' }) => {
  const [activeAdminTab, setActiveAdminTab] = useState(initialTab);
  React.useEffect(() => setActiveAdminTab(initialTab), [initialTab]);

  const adminTabs = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard, description: 'Clinic activity and live metrics' },
    { id: 'users', label: 'Patients', icon: Users, description: 'Patient accounts and summaries' },
    { id: 'practitioners', label: 'Practitioners', icon: Stethoscope, description: 'Profiles, availability and workload' },
    { id: 'staff', label: 'Staff Accounts', icon: Shield, description: 'Create and manage Vaidya and receptionist accounts' },
    { id: 'appointments', label: 'Appointments', icon: CalendarDays, description: 'Search, reschedule and cancel sessions' },
    { id: 'plans', label: 'Treatment Plans', icon: ClipboardList, description: 'Monitor clinical plans and generated sessions' },
    { id: 'therapies', label: 'Therapy Catalogue', icon: BookOpen, description: 'Manage therapies and requirements' },
    { id: 'follow-ups', label: 'Follow-ups', icon: Bell, description: 'Pending, overdue and completed follow-ups' },
    { id: 'feedback', label: 'Feedback', icon: MessageSquareText, description: 'Session feedback and practitioner summaries' },
    { id: 'activity', label: 'Activity History', icon: Activity, description: 'Recorded account, plan and session events' },
    { id: 'settings', label: 'Clinic Settings', icon: Settings, description: 'Clinic hours and booking rules' },
    { id: 'reports', label: 'Reports & Analytics', icon: FileBarChart, description: 'Date-filtered clinic reports and exports' },
    {
      id: 'verification',
      label: 'Verification Management',
      icon: Shield,
      description: 'Manage practitioner verification requests'
    },
    {
      id: 'whatsapp',
      label: 'WhatsApp Testing',
      icon: MessageSquare,
      description: 'Test WhatsApp notifications'
    },
  ];

  const renderAdminContent = () => {
    switch (activeAdminTab) {
      case 'overview':
        return <AdminOverview />;
      case 'verification':
        return <VerificationPanel user={user} />;
      case 'whatsapp':
        return <WhatsAppTester user={user} />;
      case 'users':
        return <AdminPatientManagement />;
      case 'practitioners':
        return <AdminPractitionerManagement />;
      case 'staff':
        return <AdminStaffManagement />;
      case 'therapies':
        return <TherapyCatalogue userType="admin" />;
      case 'appointments':
        return <AdminAppointments />;
      case 'plans':
        return <AdminPlans />;
      case 'follow-ups':
        return <AdminFollowUps />;
      case 'feedback':
        return <AdminFeedback />;
      case 'activity':
        return <AdminActivity />;
      case 'settings':
        return <AdminSettings />;
      case 'reports':
        return <AdminReports />;
      default:
        return <VerificationPanel user={user} />;
    }
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 px-5 py-5 shadow-sm sm:px-6">
        <div><p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-amber-700">Clinic administration</p><h1 className="text-2xl font-semibold tracking-tight text-amber-950 sm:text-3xl">Admin workspace</h1><p className="mt-1 text-sm text-amber-800">Manage AyurSutra operations and records.</p></div>
        <span className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white/80 px-3 py-2 text-xs font-semibold text-amber-800"><span className="h-2 w-2 rounded-full bg-emerald-600"/>Admin access</span>
      </header>

      <nav aria-label="Admin sections" className="horizontal-scroll overflow-x-auto rounded-xl">
        <div className="as-tabbar">
          {adminTabs.map((tab) => { const Icon = tab.icon; return <button key={tab.id} type="button" title={tab.description} aria-current={activeAdminTab === tab.id ? 'page' : undefined} onClick={() => setActiveAdminTab(tab.id)} className="as-nav-tab"><Icon aria-hidden="true" className="h-4 w-4 shrink-0"/><span>{tab.label}</span></button>; })}
        </div>
      </nav>

      <section aria-label={`${adminTabs.find((tab) => tab.id === activeAdminTab)?.label || 'Admin'} content`} className="min-w-0">
        {renderAdminContent()}
      </section>
    </div>
  );
};

export default AdminPanel;
