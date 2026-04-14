import { useState, useCallback, useMemo } from 'react';
import { useLocation, useNavigate, Outlet } from 'react-router-dom';
import { Home, Users, Phone, Kanban, FolderKanban, Brain, BarChart3, HelpCircle } from 'lucide-react';
import Logo from './Logo';
import SearchBar from './SearchBar';
import KeyboardShortcutsHelp from './KeyboardShortcutsHelp';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';

const navItems = [
  { path: '/', icon: Home, label: 'Home' },
  { path: '/pipeline', icon: Kanban, label: 'Pipeline' },
  { path: '/leads', icon: Users, label: 'Leads' },
  { path: '/dialler', icon: Phone, label: 'Dialler' },
  { path: '/projects', icon: FolderKanban, label: 'Projects' },
  { path: '/intelligence', icon: Brain, label: 'Call Intelligence' },
  { path: '/dashboard', icon: BarChart3, label: 'Stats' },
];

// All shortcuts displayed in the help modal
const shortcutEntries = [
  { label: 'Cmd+K', description: 'Search leads' },
  { label: '?', description: 'Show keyboard shortcuts' },
  { label: '1', description: 'Go to Home' },
  { label: '2', description: 'Go to Pipeline' },
  { label: '3', description: 'Go to Leads' },
  { label: '4', description: 'Go to Dialler' },
  { label: '5', description: 'Go to Projects' },
  { label: '6', description: 'Go to Intelligence' },
  { label: '7', description: 'Go to Stats' },
];

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);

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
      { key: '5', handler: () => navigate('/projects'), description: 'Go to Projects' },
      { key: '6', handler: () => navigate('/intelligence'), description: 'Go to Intelligence' },
      { key: '7', handler: () => navigate('/dashboard'), description: 'Go to Stats' },
    ],
    [navigate]
  );

  useKeyboardShortcuts(shortcuts);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-16 flex-shrink-0 bg-[#18181b] border-r border-white/[0.06] flex flex-col items-center py-6 gap-8">
        {/* Logo */}
        <button
          onClick={() => navigate('/')}
          className="transition-all duration-200 hover:opacity-80"
        >
          <Logo variant="stacked" className="text-[10px]" />
        </button>

        {/* Navigation */}
        <nav className="flex flex-col gap-2 mt-4">
          {navItems.map(({ path, icon: Icon, label }) => {
            const isActive =
              path === '/'
                ? location.pathname === '/'
                : location.pathname.startsWith(path);

            return (
              <button
                key={path}
                onClick={() => navigate(path)}
                title={label}
                className={`relative w-10 h-10 flex items-center justify-center rounded-lg transition-all duration-200 ${
                  isActive
                    ? 'bg-[rgba(52,211,153,0.15)] text-[#34d399]'
                    : 'text-[#52525b] hover:text-[#a1a1aa] hover:bg-white/[0.03]'
                }`}
              >
                {isActive && (
                  <div className="absolute left-[-13px] top-1/2 -translate-y-1/2 w-[3px] h-5 bg-[#34d399] rounded-r" />
                )}
                <Icon size={20} />
              </button>
            );
          })}
        </nav>

        {/* Spacer to push help button to bottom */}
        <div className="flex-1" />

        {/* Shortcuts help button */}
        <button
          onClick={openShortcuts}
          title="Keyboard shortcuts"
          className="w-10 h-10 flex items-center justify-center rounded-lg text-[#52525b] hover:text-[#a1a1aa] hover:bg-white/[0.03] transition-all duration-200 mb-2"
        >
          <HelpCircle size={18} />
        </button>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
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
