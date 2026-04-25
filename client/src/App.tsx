import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { DiallerProvider } from './hooks/useDiallerSession';
import { useAuth } from './hooks/useAuth';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import HomePage from './pages/HomePage';
import LeadsPage from './pages/LeadsPage';
import DiallerPage from './pages/DiallerPage';
import DispositionPage from './pages/DispositionPage';
import EmailComposePage from './pages/EmailComposePage';
import DashboardPage from './pages/DashboardPage';
import IntelligencePage from './pages/IntelligencePage';
import PipelinePage from './pages/PipelinePage';
import LeadProfilePage from './pages/LeadProfilePage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectDetailPage from './pages/ProjectDetailPage';
import ComposeEmailPage from './pages/ComposeEmailPage';
import BookMeetingPage from './pages/BookMeetingPage';
import SettingsPage from './pages/SettingsPage';
import EmailBankPage from './pages/EmailBankPage';

// Gate that redirects unauthenticated users to /login while preserving
// the page they were trying to reach as ?next=.
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center">
        <Loader2 className="animate-spin text-ink-dim" size={28} />
      </div>
    );
  }
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      {/* Everything else requires a logged-in session */}
      <Route
        path="/*"
        element={
          <RequireAuth>
            <DiallerProvider>
              <Routes>
                <Route element={<Layout />}>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/leads" element={<LeadsPage />} />
                  <Route path="/leads/:id" element={<LeadProfilePage />} />
                  <Route path="/dialler" element={<DiallerPage />} />
                  <Route path="/disposition" element={<DispositionPage />} />
                  <Route path="/email" element={<EmailComposePage />} />
                  <Route path="/compose/:leadId" element={<ComposeEmailPage />} />
                  <Route path="/book-meeting/:leadId" element={<BookMeetingPage />} />
                  <Route path="/pipeline" element={<PipelinePage />} />
                  <Route path="/intelligence" element={<IntelligencePage />} />
                  <Route path="/projects" element={<ProjectsPage />} />
                  <Route path="/projects/:id" element={<ProjectDetailPage />} />
                  <Route path="/email-bank" element={<EmailBankPage />} />
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                </Route>
              </Routes>
            </DiallerProvider>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
