import { useState, useCallback, useMemo, useEffect } from 'react';
import { useLocation, useNavigate, Outlet } from 'react-router-dom';
import { Home, Users, Phone, Kanban, FolderKanban, Brain, BarChart3, HelpCircle, Settings, Inbox, LogOut } from 'lucide-react';
import SearchBar from './SearchBar';
import KeyboardShortcutsHelp from './KeyboardShortcutsHelp';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useAuth } from '../hooks/useAuth';
import * as api from '../services/api';

const navItems = [
  { path: '/', icon: Home, label: 'Home' },
  { path: '/pipeline', icon: Kanban, label: 'Pipeline' },
  { path: '/leads', icon: Users, label: 'Leads' },
  { path: '/dialler', icon: Phone, label: 'Dialler' },
  { path: '/email-bank', icon: Inbox, label: 'Email Bank' },
  { path: '/projects', icon: FolderKanban, label: 'Projects' },
  { path: '/intelligence', icon: Brain, label: 'Call Intelligence' },
  { path: '/dashboard', icon: BarChart3, label: 'Stats' },
  { path: '/settings', icon: Settings, label: 'Settings' },
];

// All shortcuts displayed in the help modal
const shortcutEntries = [
  { label: 'Cmd+K', description: 'Search leads' },
  { label: '?', description: 'Show keyboard shortcuts' },
  { label: '1', description: 'Go to Home' },
  { label: '2', description: 'Go to Pipeline' },
  { label: '3', description: 'Go to Leads' },
  { label: '4', description: 'Go to Dialler' },
  { label: '5', description: 'Go to Email Bank' },
  { label: '6', description: 'Go to Projects' },
  { label: '7', description: 'Go to Intelligence' },
  { label: '8', description: 'Go to Stats' },
  { label: '9', description: 'Go to Settings' },
];

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [emailBankReadyCount, setEmailBankReadyCount] = useState(0);

  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);

  // Poll email-bank ready-count every 30s for the sidebar badge.
  useEffect(() => {
    let cancelled = false;
    const pull = async () => {
      try {
        const res = await api.getEmailDrafts('ready');
        if (!cancelled) setEmailBankReadyCount(res.stats.ready || 0);
      } catch {
        // silent — badge just won't update
      }
    };
    pull();
    const id = window.setInterval(pull, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Register global keyboard shortcuts
  const shortcuts = useMemo(
    () => [
      {
        key: '?',
        shift: true,
        handler: () => setShortcutsOpen((prev) => !prev),
        description: 'Show keyboard shortcuts',
      },
      { key: '1', handler: () => navigate('/'), description: 'Go to Home' },
      { key: '2', handler: () => navigate('/pipeline'), description: 'Go to Pipeline' },
      { key: '3', handler: () => navigate('/leads'), description: 'Go to Leads' },
      { key: '4', handler: () => navigate('/dialler'), description: 'Go to Dialler' },
      { key: '5', handler: () => navigate('/email-bank'), description: 'Go to Email Bank' },
      { key: '6', handler: () => navigate('/projects'), description: 'Go to Projects' },
      { key: '7', handler: () => navigate('/intelligence'), description: 'Go to Intelligence' },
      { key: '8', handler: () => navigate('/dashboard'), description: 'Go to Stats' },
      { key: '9', handler: () => navigate('/settings'), description: 'Go to Settings' },
    ],
    [navigate]
  );

  useKeyboardShortcuts(shortcuts);

  return (
    <div className="flex h-screen overflow-hidden bg-cream">
      {/* Sidebar */}
      <aside className="w-16 flex-shrink-0 bg-paper border-r border-hair-soft flex flex-col items-center py-6 gap-8">
        {/* OxyScale favicon */}
        <button
          onClick={() => navigate('/')}
          className="transition-all duration-200 hover:scale-105"
          title="OxyScale"
        >
          <img
            src="/favicon.svg"
            alt="OxyScale"
            width={28}
            height={28}
            className="block"
          />
        </button>

        {/* Navigation */}
        <nav className="flex flex-col gap-2 mt-4">
          {navItems.map(({ path, icon: Icon, label }) => {
            const isActive =
              path === '/'
                ? location.pathname === '/'
                : location.pathname.startsWith(path);

            const showBadge = path === '/email-bank' && emailBankReadyCount > 0;
            return (
              <button
                key={path}
                onClick={() => navigate(path)}
                title={label}
                className={`relative w-10 h-10 flex items-center justify-center rounded-lg transition-all duration-200 ${
                  isActive
                    ? 'bg-sky-wash text-sky-ink'
                    : 'text-sky-ink hover:bg-sky-wash/60'
                }`}
              >
                {isActive && (
                  <div className="absolute left-[-13px] top-1/2 -translate-y-1/2 w-[3px] h-5 bg-sky-ink rounded-r" />
                )}
                <Icon size={20} />
                {showBadge && (
                  <span
                    aria-label={`${emailBankReadyCount} drafts ready`}
                    className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-sky-ink text-white text-[10px] font-bold flex items-center justify-center leading-none shadow-btn-hover"
                  >
                    {emailBankReadyCount > 99 ? '99+' : emailBankReadyCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Spacer to push help button to bottom */}
        <div className="flex-1" />

        {/* Current user initials. Click to sign out. */}
        {user && (
          <button
            onClick={signOut}
            title={`${user.name} — click to sign out`}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-tray border border-hair-soft text-ink-muted text-xs font-semibold tracking-tight hover:bg-sky-wash hover:border-sky-hair hover:text-sky-ink transition-all duration-200 group relative"
          >
            <span className="group-hover:hidden">
              {user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
            </span>
            <LogOut size={16} className="hidden group-hover:block" />
          </button>
        )}

        {/* Shortcuts help button */}
        <button
          onClick={openShortcuts}
          title="Keyboard shortcuts"
          className="w-10 h-10 flex items-center justify-center rounded-lg text-sky-ink hover:bg-sky-wash/60 transition-all duration-200 mb-2"
        >
          <HelpCircle size={18} />
        </button>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-cream">
        <Outlet />
      </main>

      {/* Global search overlay */}
      <SearchBar />

      {/* Keyboard shortcuts help modal */}
      <KeyboardShortcutsHelp
        open={shortcutsOpen}
        onClose={closeShortcuts}
        shortcuts={shortcutEntries}
      />
    </div>
  );
}
