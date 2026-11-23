import React, { useState, useEffect } from "react";
import Header from "./components/Header";
import Navigation from "./components/Navigation";
import PatientDashboard from "./components/Dashboard/PatientDashboard";
import PractitionerDashboard from "./components/Dashboard/PractitionerDashboard";
import TherapyScheduling from "./components/TherapyScheduling";
import Notifications from "./components/Notifications";
import AdminPanel from './components/Admin/AdminPanel';
import Progress from "./components/Progress";
import PractitionerProgress from "./components/PractitionerProgress";
import Profile from "./components/Profile";
import PractitionerSearch from "./components/PractitionerSearch";
import Footer from "./components/Footer";
import AuthContainer from "./components/auth/AuthContainer";
import LandingPage from "./components/LandingPage";
import PractitionerHomePage from "./components/PractitionerHomePage";
import PatientManagement from "./components/practitioner/PatientManagement";
import PatientDetail from "./components/practitioner/PatientDetail";
import TherapyCatalogue from './components/TherapyCatalogue';
import SessionOperations from './components/scheduling/SessionOperations';
import PatientAppointments from './components/patient/PatientAppointments';
import PatientTherapySchedule from './components/patient/PatientTherapySchedule';
import PatientTreatmentProgress from './components/patient/PatientTreatmentProgress';
import PatientFollowUps from './components/patient/PatientFollowUps';
import PractitionerAvailability from './components/practitioner/PractitionerAvailability';
import PractitionerFollowUps from './components/practitioner/PractitionerFollowUps';
import { useAppData } from "./hooks/useAppData";
import useNotifications from './hooks/useNotifications';
import ChatbotWidget from "./components/Dashboard/ChatbotWidget"; // ✅ import chatbot
import { ToastProvider } from "./contexts/ToastContext.jsx";
import ToastContainer from "./components/Toast";
import ErrorBoundary from './components/ErrorBoundary';
import ReceptionistDashboard from './components/Dashboard/ReceptionistDashboard';
import authFetch from './utils/apiClient';
import ForcePasswordChange from './components/auth/ForcePasswordChange';

const App = () => {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [showQuickMenu, setShowQuickMenu] = useState(false);
  const [isMenuSticky, setIsMenuSticky] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecking, setAuthChecking] = useState(() => Boolean(localStorage.getItem('token')));
  const [user, setUser] = useState(null);
  const [globalPatientSearch, setGlobalPatientSearch] = useState('');
  const [selectedPatientId, setSelectedPatientId] = useState(null);
  const [showLanding, setShowLanding] = useState(false);

  const {
    therapySessions,
    patientProgress,
    feedbackData,
  } = useAppData();
  const { notifications, unreadCount, refresh: refreshNotifications, markAllAsRead } = useNotifications(isAuthenticated);

  // Restore a valid JWT session on refresh using the server profile as the source of truth.
  useEffect(() => {
    let active = true;
    const token = localStorage.getItem('token');
    if (!token) { setAuthChecking(false); return () => { active = false; }; }
    authFetch('/api/profile').then(async (response) => {
      if (!response.ok) throw new Error('Session is no longer valid');
      return response.json();
    }).then((profile) => {
      if (!active || !profile?._id || !profile?.userType) return;
      setUser(profile); setIsAuthenticated(true); setShowLanding(false);
    }).catch(() => {
      if (!active) return;
      localStorage.removeItem('token'); localStorage.removeItem('user'); setUser(null); setIsAuthenticated(false); setShowLanding(false);
    }).finally(() => { if (active) setAuthChecking(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      setUser(null);
      setIsAuthenticated(false);
      setShowLanding(false);
      setActiveTab('dashboard');
    };
    window.addEventListener('ayursutra:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('ayursutra:unauthorized', handleUnauthorized);
  }, []);

  // ✅ Called after login/signup success
  const handleAuthSuccess = async (authData) => {
    // Determine token: prefer explicit token on authData, otherwise use what's in localStorage
    const tokenFromArg = authData?.token;
    const storedToken = localStorage.getItem('token');
    const tokenToUse = tokenFromArg || storedToken;

    if (tokenToUse) {
      localStorage.setItem('token', tokenToUse);
    }

    try {
      // Fetch full user profile using authFetch which will attach token from localStorage
      // import dynamically to avoid top-level changes
      const response = await authFetch('/api/profile', {
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) throw new Error('Your session could not be verified. Please sign in again.');
      const fullUser = await response.json();
      if (!fullUser?._id || !fullUser?.userType) throw new Error('Your session could not be verified. Please sign in again.');
      setUser(fullUser);
      setIsAuthenticated(true);
      setShowLanding(false);
      refreshNotifications();
    } catch (_error) {
      // Do not enter any role dashboard until the backend confirms the identity.
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      setUser(null);
      setIsAuthenticated(false);
      setShowLanding(false);
    }
  };

  // ✅ Handle Google OAuth success and tab navigation
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const token = hashParams.get('token') || urlParams.get('token');
    const userParam = hashParams.get('user') || urlParams.get('user');
    const auth = hashParams.get('auth') || urlParams.get('auth');
    const tab = urlParams.get('tab');
    
    if (token && userParam && auth === 'google' && !isAuthenticated) {
      try {
        // Decode user data
        const userData = JSON.parse(decodeURIComponent(userParam));
        
        // Store token and user data
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(userData));
        
        // Authenticate the user
        handleAuthSuccess(userData);
        
        // Clean up URL parameters
        window.history.replaceState({}, document.title, window.location.pathname);
      } catch (error) {
        console.error('Google OAuth success error:', error);
      }
    }
    
    // Handle tab navigation
    if (tab && isAuthenticated) {
      setActiveTab(tab);
      // Clean up URL
      const newUrl = window.location.pathname;
      window.history.replaceState({}, document.title, newUrl);
    }
  }, [isAuthenticated]);

  // ✅ Logout
  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setIsAuthenticated(false);
    setUser(null);
    setSelectedPatientId(null);
    setActiveTab("dashboard");
    setShowLanding(true);
  };

  // ✅ When "Get Started" is clicked on landing page
  const handleGetStarted = () => {
    setShowLanding(false);
  };

  // ✅ Utility: Get current role
  const getUserRole = () => {
    return user?.userType || "patient";
  };

  // ✅ Render tab contents
  const renderActiveTab = () => {
    const userRole = getUserRole();

    switch (activeTab) {
      case "dashboard":
        if (userRole === 'admin') return <AdminPanel user={user} initialTab="overview" />;
        if (userRole === 'receptionist') return <ReceptionistDashboard user={user} view={activeTab} patientSearch={globalPatientSearch} onPatientSearchChange={setGlobalPatientSearch} />;
        if (userRole === "practitioner") {
          return <PractitionerDashboard user={user} onNavigate={setActiveTab} onSelectPatient={(patientId) => {
            setSelectedPatientId(patientId);
            setActiveTab('practitioner-patients');
          }} />;
        }
        return (
          <PatientDashboard
            patientProgress={patientProgress}
            notifications={notifications}
            user={user}
            onNavigate={setActiveTab}
          />
        );

      case "scheduling":
        return (
          <TherapyScheduling
            userRole={userRole}
            user={user}
            therapySessions={therapySessions}
          />
        );

      case 'session-operations':
      case 'patient-sessions':
        return <SessionOperations user={user} userType={userRole} />;

      case 'appointments':
        return userRole === 'patient' ? <PatientAppointments user={user} /> : null;

      case 'therapy-schedule':
        return userRole === 'patient' ? <PatientTherapySchedule user={user} /> : null;

      case 'treatment-progress':
        return userRole === 'patient' ? <PatientTreatmentProgress user={user} /> : null;

      case 'follow-ups':
        return userRole === 'patient' ? <PatientFollowUps user={user} /> : null;

      case 'therapy-catalogue':
        return ['practitioner', 'admin'].includes(userRole) ? <TherapyCatalogue userType={userRole} /> : null;

      case 'practitioner-follow-ups':
        return userRole === 'practitioner' ? <PractitionerFollowUps onSelectPatient={(patientId) => { setSelectedPatientId(patientId); setActiveTab('practitioner-patients'); }} /> : null;

      case 'practitioner-availability':
        return userRole === 'practitioner' ? <PractitionerAvailability user={user} /> : null;

      case 'reception-patients': case 'reception-appointments': case 'reception-therapy-scheduling': case 'reception-checkin': case 'reception-availability': case 'reception-reports':
        return userRole === 'receptionist' ? <ReceptionistDashboard user={user} view={activeTab} patientSearch={globalPatientSearch} onPatientSearchChange={setGlobalPatientSearch} /> : null;

      case "practitioner-patients":
        if (userRole !== 'practitioner') return null;
        return selectedPatientId
          ? <PatientDetail patientId={selectedPatientId} onBack={() => setSelectedPatientId(null)} />
          : <PatientManagement onSelectPatient={setSelectedPatientId} />;

      case "notifications":
        return (
          <Notifications
            notifications={notifications}
            currentUserId={user?._id}
            currentUserEmail={user?.email}
            userType={user?.userType}
          />
        );

      case "progress":
        if (userRole === "practitioner") {
          return <PractitionerProgress key={`progress-${activeTab}`} user={user} />;
        }
        return <Progress user={user} />;

      case "profile":
        return <Profile user={user} />;

      case "practitioner-search":
        return <PractitionerSearch user={user} onAssignmentSuccess={(practitioner) => {
          // Update user state with assigned practitioner
          setUser(prev => ({ ...prev, assignedPractitioner: practitioner._id }));
        }} />;

      case 'admin-whatsapp':
      case 'admin-verification':
        return <AdminPanel user={user} />;

      case 'admin-patients':
        return userRole === 'admin' ? <AdminPanel user={user} initialTab="users" /> : null;

      case 'admin-operations':
        return userRole === 'admin' ? <AdminPanel user={user} initialTab="overview" /> : null;

      case 'admin-reports':
        return userRole === 'admin' ? <AdminPanel user={user} initialTab="reports" /> : null;

      case 'admin-practitioners':
        return userRole === 'admin' ? <AdminPanel user={user} initialTab="practitioners" /> : null;

      case 'admin-therapies':
        return userRole === 'admin' ? <AdminPanel user={user} initialTab="therapies" /> : null;

      default:
        if (userRole === "practitioner") {
          return <PractitionerDashboard user={user} onNavigate={setActiveTab} onSelectPatient={(patientId) => {
            setSelectedPatientId(patientId);
            setActiveTab('practitioner-patients');
          }} />;
        }
        return (
          <PatientDashboard
            patientProgress={patientProgress}
            notifications={notifications}
            user={user}
            onNavigate={setActiveTab}
          />
        );
    }
  };

  // Wrap whole UI in ToastProvider so landing and auth pages can use useToast().
  return (
    <ToastProvider>
      {/* Render Landing, Auth or Main app depending on state */}
      {authChecking ? (
        <main className="flex min-h-screen items-center justify-center bg-[#FDF7E9] text-amber-900" role="status">Restoring your secure AyurSutra session…</main>
      ) : showLanding ? (
        <LandingPage onGetStarted={handleGetStarted} />
      ) : !isAuthenticated ? (
        <AuthContainer
          onAuthSuccess={handleAuthSuccess}
          onBackToLanding={() => setShowLanding(true)}
        />
      ) : user?.mustChangePassword ? (
        <ForcePasswordChange user={user} onComplete={() => setUser((current) => ({ ...current, mustChangePassword: false }))} />
      ) : (
  <ErrorBoundary>
  <div className="min-h-screen bg-[#FDF7E9]">
          <Header
            userRole={getUserRole()}
            notifications={notifications}
            unreadCount={unreadCount}
            onMarkAllRead={markAllAsRead}
            setActiveTab={setActiveTab}
            user={user}
            onLogout={handleLogout}
            globalPatientSearch={globalPatientSearch}
            onGlobalPatientSearchChange={setGlobalPatientSearch}
          />

          {user?.userType === 'receptionist' ? (
            <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-start lg:gap-6 lg:px-8">
              <Navigation activeTab={activeTab} setActiveTab={setActiveTab} userType={user.userType} />
              <main className="min-w-0 flex-1 py-2">{renderActiveTab()}</main>
            </div>
          ) : (
            <>
              <Navigation activeTab={activeTab} setActiveTab={setActiveTab} userType={user?.userType} />
              <div className="w-full bg-[#FDF7E9]">
                <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{renderActiveTab()}</main>
              </div>
            </>
          )}

          {/* ✅ Floating chatbot widget for logged-in users except practitioners */}
          {isAuthenticated && user?.userType === "patient" && (
            <div className="fixed bottom-6 right-6 z-50">
              <ChatbotWidget user={user} />
            </div>
          )}

          <Footer />

  </div>
  </ErrorBoundary>
      )}

      {/* Toast container rendered once inside provider so toasts are visible on landing/auth */}
      <ToastContainer />
    </ToastProvider>
  );
};

export default App;
