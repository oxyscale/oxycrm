// ============================================================
// useKeyboardShortcuts — Global keyboard shortcut registration
// Ignores keystrokes when the user is typing in an input,
// textarea, or contenteditable element.
// ============================================================

import { useEffect } from 'react';

export interface KeyboardShortcut {
  /** The key to listen for (e.g. "k", "?", "Escape"). Case-insensitive match against e.key. */
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  handler: () => void;
  /** Human-readable description shown in the help overlay */
  description: string;
  /** Human-readable label for the key combo (e.g. "Cmd+K") */
  label?: string;
}

/**
 * Returns true if the event target is an editable element
 * (input, textarea, contenteditable) where we should NOT
 * intercept single-key shortcuts.
 */
function isEditableTarget(e: KeyboardEvent): boolean {
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if ((e.target as HTMLElement)?.isContentEditable) return true;
  return false;
}

export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[]) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      for (const s of shortcuts) {
        const keyMatch = e.key.toLowerCase() === s.key.toLowerCase();
        const ctrlMatch = !!s.ctrl === (e.ctrlKey || e.metaKey);
        const metaMatch = s.meta ? e.metaKey : true;
        const shiftMatch = !!s.shift === e.shiftKey;

        // For shortcuts that require a modifier (ctrl/meta), allow them
        // even in editable fields (e.g. Cmd+K). For plain key shortcuts
        // (like "?"), skip if the user is typing.
        const hasModifier = s.ctrl || s.meta;

        if (keyMatch && ctrlMatch && metaMatch && shiftMatch) {
          if (!hasModifier && isEditableTarget(e)) continue;
          e.preventDefault();
          s.handler();
          return;
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shortcuts]);
}
