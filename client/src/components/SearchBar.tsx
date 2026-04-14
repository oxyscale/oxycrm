// ============================================================
// SearchBar — Global search overlay (Cmd+K / Ctrl+K)
// Searches leads by name, company, phone, or email
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, User, Building2, Phone, ArrowRight } from 'lucide-react';
import { searchLeads } from '../services/api';
import type { Lead, CallLog } from '../types';

type SearchResult = Lead & { lastCallLog: CallLog | null };

export default function SearchBar() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Debounce timer ref
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Open / close ──────────────────────────────────────────

  const openSearch = useCallback(() => {
    setOpen(true);
    setQuery('');
    setResults([]);
    setSelectedIndex(0);
  }, []);

  const closeSearch = useCallback(() => {
    setOpen(false);
    setQuery('');
    setResults([]);
    setSelectedIndex(0);
  }, []);

  // ── Keyboard shortcut: Cmd+K / Ctrl+K ────────────────────

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (open) {
          closeSearch();
        } else {
          openSearch();
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, openSearch, closeSearch]);

  // ── Focus input when opened ──────────────────────────────

  useEffect(() => {
    if (open && inputRef.current) {
      // Small delay to ensure the modal is rendered
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // ── Debounced search ─────────────────────────────────────

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await searchLeads(trimmed);
        setResults(data);
        setSelectedIndex(0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // ── Navigate to selected result ──────────────────────────

  const selectResult = useCallback(
    (lead: SearchResult) => {
      closeSearch();
      navigate(`/leads/${lead.id}`);
    },
    [closeSearch, navigate]
  );

  // ── Keyboard navigation inside the list ──────────────────

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      closeSearch();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && results.length > 0) {
      e.preventDefault();
      selectResult(results[selectedIndex]);
    }
  }

  // ── Scroll selected item into view ───────────────────────

  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll('[data-search-item]');
    const selected = items[selectedIndex];
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // ── Pipeline stage label ─────────────────────────────────

  function stageLabel(stage: string): string {
    const labels: Record<string, string> = {
      new_lead: 'New Lead',
      follow_up: 'Follow Up',
      call_booked: 'Call Booked',
      negotiation: 'Negotiation',
      won: 'Won',
      lost: 'Lost',
      not_interested: 'Not Interested',
    };
    return labels[stage] || stage;
  }

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        onClick={closeSearch}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4 pointer-events-none">
        <div
          className="w-full max-w-lg bg-[#18181b] border border-white/[0.06] rounded-xl shadow-2xl pointer-events-auto overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
            <Search size={18} className="text-[#52525b] flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search leads by name, company, phone, or email..."
              className="flex-1 bg-transparent text-[#fafafa] placeholder-[#52525b] text-sm outline-none"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="text-[#52525b] hover:text-[#a1a1aa] transition-colors"
              >
                <X size={16} />
              </button>
            )}
            <kbd className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium text-[#52525b] bg-[#09090b] border border-white/[0.06] rounded">
              ESC
            </kbd>
          </div>

          {/* Results */}
          <div
            ref={listRef}
            className="max-h-[360px] overflow-y-auto"
          >
            {/* Loading state */}
            {loading && query.trim().length >= 2 && (
              <div className="px-4 py-8 text-center">
                <div className="inline-block w-5 h-5 border-2 border-[#34d399]/30 border-t-[#34d399] rounded-full animate-spin" />
                <p className="text-[#52525b] text-xs mt-2">Searching...</p>
              </div>
            )}

            {/* Empty query hint */}
            {!loading && query.trim().length < 2 && (
              <div className="px-4 py-8 text-center">
                <Search size={24} className="mx-auto text-[#52525b] mb-2" />
                <p className="text-[#52525b] text-sm">Type at least 2 characters to search</p>
              </div>
            )}

            {/* No results */}
            {!loading && query.trim().length >= 2 && results.length === 0 && (
              <div className="px-4 py-8 text-center">
                <User size={24} className="mx-auto text-[#52525b] mb-2" />
                <p className="text-[#a1a1aa] text-sm">No leads found</p>
                <p className="text-[#52525b] text-xs mt-1">Try a different search term</p>
              </div>
            )}

            {/* Result list */}
            {!loading && results.length > 0 && (
              <ul className="py-1">
                {results.map((lead, index) => (
                  <li key={lead.id}>
                    <button
                      data-search-item
                      onClick={() => selectResult(lead)}
                      onMouseEnter={() => setSelectedIndex(index)}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                        index === selectedIndex
                          ? 'bg-[#1f1f23]'
                          : 'hover:bg-[#1f1f23]/50'
                      }`}
                    >
                      {/* Avatar / icon */}
                      <div className="w-9 h-9 rounded-lg bg-[#09090b] border border-white/[0.06] flex items-center justify-center flex-shrink-0">
                        <User size={16} className="text-[#52525b]" />
                      </div>

                      {/* Lead info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-[#fafafa] truncate">
                            {lead.name}
                          </span>
                          {lead.category && (
                            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-[#34d399]/10 text-[#34d399] flex-shrink-0">
                              {lead.category}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5">
                          {lead.company && (
                            <span className="flex items-center gap-1 text-xs text-[#a1a1aa] truncate">
                              <Building2 size={11} className="flex-shrink-0" />
                              {lead.company}
                            </span>
                          )}
                          {lead.phone && (
                            <span className="flex items-center gap-1 text-xs text-[#52525b] flex-shrink-0">
                              <Phone size={11} />
                              {lead.phone}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Stage badge + arrow */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-[10px] text-[#52525b]">
                          {stageLabel(lead.pipelineStage)}
                        </span>
                        <ArrowRight
                          size={14}
                          className={`transition-colors ${
                            index === selectedIndex ? 'text-[#34d399]' : 'text-[#52525b]'
                          }`}
                        />
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Footer hint */}
          {results.length > 0 && (
            <div className="px-4 py-2 border-t border-white/[0.06] flex items-center gap-4 text-[10px] text-[#52525b]">
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 bg-[#09090b] border border-white/[0.06] rounded text-[10px]">
                  ↑↓
                </kbd>
                Navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 bg-[#09090b] border border-white/[0.06] rounded text-[10px]">
                  ↵
                </kbd>
                Open
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 bg-[#09090b] border border-white/[0.06] rounded text-[10px]">
                  Esc
                </kbd>
                Close
              </span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
