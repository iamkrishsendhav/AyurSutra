import React, { useState, useEffect } from "react";
import LoginPage from "./LoginPage";
import SignupPage from "./SignupPage";
import GoogleAuthSuccess from "./GoogleAuthSuccess";

const AuthContainer = ({ onAuthSuccess, onBackToLanding }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [expectedRole, setExpectedRole] = useState('patient');
  const [showGoogleAuth, setShowGoogleAuth] = useState(false);
  // store prefill credentials after signup so LoginPage can use them
  const [prefill, setPrefill] = useState({ email: "", password: "" });

  // Check for Google OAuth success parameters
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const user = urlParams.get('user');
    const auth = urlParams.get('auth');
    
    if (token && user && auth === 'google') {
      setShowGoogleAuth(true);
    }
  }, []);

  const handleAuthSuccess = (userData) => {
    // ✅ Pass the full user object (_id, name, email, userType) to App.jsx
    if (onAuthSuccess) {
      onAuthSuccess(userData);
    }
  };

  const handleSignupSuccess = (creds) => {
    // creds = { email, password } from SignupPage
    // If server returned a user object (with _id) then treat as logged in and forward to App
    if (creds && creds._id) {
      if (onAuthSuccess) onAuthSuccess(creds);
      return;
    }

    if (creds && creds.email) {
      setPrefill({ email: creds.email, password: creds.password || "" });
    }
    // switch to login view so user can sign in (prefilled)
    setIsLogin(true);
  };

  return (
    <>
      {showGoogleAuth ? (
        <GoogleAuthSuccess onAuthSuccess={handleAuthSuccess} />
      ) : isLogin ? (
        <LoginPage
          onSwitchToSignup={() => { setExpectedRole('patient'); setIsLogin(false); }}
          onAuthSuccess={handleAuthSuccess}
          onBackToLanding={onBackToLanding}
          expectedRole={expectedRole}
          onRoleChange={setExpectedRole}
          prefillEmail={prefill.email}
          prefillPassword={prefill.password}
        />
      ) : (
        <SignupPage
          onSwitchToLogin={() => setIsLogin(true)}
          onSignupSuccess={handleSignupSuccess}
          onBackToLanding={onBackToLanding}
        />
      )}
    </>
  );
};

export default AuthContainer;

