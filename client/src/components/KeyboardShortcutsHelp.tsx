// ============================================================
// KeyboardShortcutsHelp — Modal overlay listing available
// keyboard shortcuts. Styled to match SearchBar (dark card,
// backdrop blur). Close with Escape or click outside.
// ============================================================

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface ShortcutEntry {
  label: string;
  description: string;
}

interface KeyboardShortcutsHelpProps {
  open: boolean;
  onClose: () => void;
  shortcuts: ShortcutEntry[];
}

export default function KeyboardShortcutsHelp({
  open,
  onClose,
  shortcuts,
}: KeyboardShortcutsHelpProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4 pointer-events-none">
        <div
          ref={panelRef}
          className="w-full max-w-md bg-[#18181b] border border-white/[0.06] rounded-xl shadow-2xl pointer-events-auto overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
            <h2 className="text-sm font-semibold text-[#fafafa]">
              Keyboard Shortcuts
            </h2>
            <button
              onClick={onClose}
              className="text-[#52525b] hover:text-[#a1a1aa] transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Shortcut list */}
          <div className="px-4 py-3 space-y-2">
            {shortcuts.map((s, i) => (
              <div
                key={i}
                className="flex items-center justify-between py-1.5"
              >
                <span className="text-sm text-[#a1a1aa]">{s.description}</span>
                <kbd className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-[#a1a1aa] bg-[#09090b] border border-white/[0.06] rounded">
                  {s.label}
                </kbd>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-white/[0.06]">
            <p className="text-[10px] text-[#52525b]">
              Press Esc to close
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
