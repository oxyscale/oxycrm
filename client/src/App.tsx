import { Routes, Route } from 'react-router-dom';
import { DiallerProvider } from './hooks/useDiallerSession';
import Layout from './components/Layout';
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

export default function App() {
  return (
    <DiallerProvider>
      <Routes>
{/* Main app with sidebar layout */}
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
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </DiallerProvider>
  );
}
