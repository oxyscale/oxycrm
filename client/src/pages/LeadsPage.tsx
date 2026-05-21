import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  ArrowUpDown,
  ChevronRight,
  UserPlus,
} from 'lucide-react';
import * as api from '../services/api';
import type { Lead } from '../types';
import EyebrowLabel from '../components/ui/EyebrowLabel';
import SectionHeading from '../components/ui/SectionHeading';
import PillButton from '../components/ui/PillButton';

type SortField = 'name' | 'category' | 'queuePosition';
type SortDir = 'asc' | 'desc';

export default function LeadsPage() {
  const navigate = useNavigate();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterContacted, setFilterContacted] = useState<'all' | 'contacted' | 'not_contacted'>('all');
  const [sortField, setSortField] = useState<SortField>('queuePosition');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  useEffect(() => {
    loadLeads();
  }, [filterContacted]);

  const loadLeads = async () => {
    try {
      setLoading(true);
      const params: Parameters<typeof api.getLeads>[0] = {};
      if (filterContacted === 'contacted') params.contacted = 'true';
      else if (filterContacted === 'not_contacted') params.contacted = 'false';
      const data = await api.getLeads(params);
      setLeads(data);
    } catch (err) {
      console.error('Failed to load leads:', err);
    } finally {
      setLoading(false);
    }
  };

  const categories = [...new Set(leads.map((l) => l.category).filter(Boolean))] as string[];

  const filtered = leads
    .filter((lead) => {
      if (filterCategory === 'none' && lead.category) return false;
      if (filterCategory !== 'all' && filterCategory !== 'none' && lead.category !== filterCategory) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          lead.name.toLowerCase().includes(q) ||
          (lead.company || '').toLowerCase().includes(q) ||
          (lead.phone || '').includes(q) ||
          (lead.email || '').toLowerCase().includes(q)
        );
      }
      return true;
    })
    .sort((a, b) => {
      const aVal = a[sortField] ?? '';
      const bVal = b[sortField] ?? '';
      const cmp = typeof aVal === 'number' && typeof bVal === 'number'
        ? aVal - bVal
        : String(aVal).localeCompare(String(bVal));
      return sortDir === 'asc' ? cmp : -cmp;
    });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <div className="text-ink-dim">Loading leads...</div>
      </div>
    );
  }

  return (
    <div className="p-10 min-h-full bg-cream">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between gap-6">
        <div>
          <EyebrowLabel variant="pill" className="mb-4">
            DIRECTORY · LEADS
          </EyebrowLabel>
          <SectionHeading size="section">All leads.</SectionHeading>
          <p className="text-ink-muted text-sm mt-3">
            {leads.length} total
          </p>
        </div>
        <PillButton
          variant="outline"
          size="md"
          trailing="none"
          icon={<UserPlus size={16} className="text-sky-ink" />}
          onClick={() => navigate('/?create=lead')}
        >
          Create lead
        </PillButton>
      </div>

      {/* Filters bar */}
      <div className="flex items-center gap-3 mb-6">
        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-dim" />
          <input
            type="text"
            placeholder="Search leads..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-paper border border-hair-soft rounded-lg pl-10 pr-4 py-2.5 text-sm text-ink placeholder-ink-dim focus:outline-none focus:border-[rgba(10,156,212,0.3)] transition-all"
          />
        </div>

        {/* Category filter */}
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="bg-paper border border-hair-soft rounded-lg px-3 py-2.5 text-sm text-ink-muted focus:outline-none focus:border-[rgba(10,156,212,0.3)] transition-all"
        >
          <option value="all">All Categories</option>
          <option value="none">No Category</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>

        {/* Contacted toggle — cycles: all → contacted → not_contacted → all */}
        <button
          type="button"
          onClick={() =>
            setFilterContacted((prev) =>
              prev === 'all' ? 'contacted' : prev === 'contacted' ? 'not_contacted' : 'all'
            )
          }
          className={`rounded-full px-4 py-2 text-sm font-medium border transition-all select-none ${
            filterContacted === 'contacted'
              ? 'bg-[rgba(16,185,129,0.1)] border-[rgba(16,185,129,0.3)] text-[#10b981]'
              : filterContacted === 'not_contacted'
                ? 'bg-[rgba(239,68,68,0.08)] border-[rgba(239,68,68,0.25)] text-[#ef4444]'
                : 'bg-paper border-hair-soft text-ink-muted hover:bg-[rgba(11,13,14,0.03)]'
          }`}
        >
          {filterContacted === 'contacted'
            ? 'Contacted'
            : filterContacted === 'not_contacted'
              ? 'Not Contacted'
              : 'All Status'}
        </button>
      </div>

      {/* Table */}
      <div className="bg-paper border border-sky-hair shadow-sky-elevated rounded-2xl overflow-hidden">
        <table className="w-full table-fixed">
          <thead>
            <tr className="border-b border-hair-soft">
              <th className="w-10 text-left text-ink-dim text-xs font-medium uppercase tracking-wider px-3 py-3 select-none cursor-pointer hover:text-ink-muted transition-colors" onClick={() => handleSort('queuePosition')}>
                <span className="flex items-center gap-1">
                  #
                  {sortField === 'queuePosition' && <ArrowUpDown size={12} className="text-sky-ink" />}
                </span>
              </th>
              <th className="text-left text-ink-dim text-xs font-medium uppercase tracking-wider px-3 py-3 select-none cursor-pointer hover:text-ink-muted transition-colors" onClick={() => handleSort('name')}>
                <span className="flex items-center gap-1">
                  Name
                  {sortField === 'name' && <ArrowUpDown size={12} className="text-sky-ink" />}
                </span>
              </th>
              <th className="w-[120px] text-left text-ink-dim text-xs font-medium uppercase tracking-wider px-3 py-3 select-none cursor-pointer hover:text-ink-muted transition-colors" onClick={() => handleSort('category')}>
                <span className="flex items-center gap-1">
                  Category
                  {sortField === 'category' && <ArrowUpDown size={12} className="text-sky-ink" />}
                </span>
              </th>
              <th className="w-[120px] text-left text-ink-dim text-xs font-medium uppercase tracking-wider px-3 py-3">Status</th>
              <th className="w-[85px] px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((lead) => (
              <tr
                key={lead.id}
                className="border-b border-hair-soft hover:bg-[rgba(10,156,212,0.04)] transition-colors"
              >
                <td className="px-3 py-3 text-ink-dim text-sm">
                  {lead.queuePosition}
                </td>
                <td className="px-3 py-3">
                  <div
                    className="text-ink text-sm font-medium hover:text-sky-ink cursor-pointer transition-colors truncate"
                    onClick={() => navigate(`/leads/${lead.id}`)}
                  >
                    {lead.name}
                  </div>
                  <div className="text-ink-dim text-xs mt-0.5 truncate">
                    {lead.company || ''}{lead.company && lead.phone ? ' · ' : ''}{lead.phone}
                    {lead.website && (
                      <>
                        {' · '}
                        <a
                          href={lead.website.startsWith('http') ? lead.website : `https://${lead.website}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-ink-dim hover:text-sky-ink transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {lead.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
                        </a>
                      </>
                    )}
                  </div>
                </td>
                <td className="px-3 py-3">
                  {lead.category && (
                    <span className="bg-[rgba(10,156,212,0.15)] text-sky-ink text-xs px-2.5 py-1 rounded-full whitespace-nowrap">
                      {lead.category}
                    </span>
                  )}
                </td>
                <td className="px-3 py-3">
                  {lead.contacted ? (
                    <span className="bg-[rgba(16,185,129,0.1)] text-[#10b981] text-xs px-2.5 py-1 rounded-full whitespace-nowrap">
                      Contacted
                    </span>
                  ) : (
                    <span className="bg-[rgba(239,68,68,0.08)] text-[#ef4444] text-xs px-2.5 py-1 rounded-full whitespace-nowrap">
                      Not Contacted
                    </span>
                  )}
                </td>
                <td className="px-3 py-3">
                  <button
                    onClick={() => navigate(`/leads/${lead.id}`)}
                    className="text-ink-muted hover:text-sky-ink transition-colors flex items-center gap-1 text-xs"
                  >
                    Open
                    <ChevronRight size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div className="text-center py-12 text-ink-dim">
            {search || filterCategory !== 'all' || filterContacted !== 'all'
              ? 'No leads match your filters'
              : 'No leads imported yet'}
          </div>
        )}
      </div>
    </div>
  );
}
