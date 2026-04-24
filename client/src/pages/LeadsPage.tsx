import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  ArrowUpDown,
  Filter,
  Phone,
  Flame,
  Thermometer,
  Snowflake,
} from 'lucide-react';
import { useDialler } from '../hooks/useDiallerSession';
import * as api from '../services/api';
import type { Lead } from '../types';
import EyebrowLabel from '../components/ui/EyebrowLabel';
import SectionHeading from '../components/ui/SectionHeading';

type SortField = 'name' | 'category' | 'queuePosition' | 'status' | 'lastCalledAt';
type SortDir = 'asc' | 'desc';

export default function LeadsPage() {
  const navigate = useNavigate();
  const { setCurrentLead, updateCallState, startSession } = useDialler();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterTemperature, setFilterTemperature] = useState<string>('all');
  const [lastCalledSort, setLastCalledSort] = useState<'default' | 'recent' | 'oldest'>('default');
  const [sortField, setSortField] = useState<SortField>('queuePosition');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  useEffect(() => {
    loadLeads();
  }, []);

  const loadLeads = async () => {
    try {
      setLoading(true);
      const data = await api.getLeads();
      setLeads(data);
    } catch (err) {
      console.error('Failed to load leads:', err);
    } finally {
      setLoading(false);
    }
  };

  // Get unique categories
  const categories = [...new Set(leads.map((l) => l.category).filter(Boolean))] as string[];

  // Filter and sort
  const filtered = leads
    .filter((lead) => {
      if (filterStatus !== 'all' && lead.status !== filterStatus) return false;
      if (filterCategory !== 'all' && lead.category !== filterCategory) return false;
      if (filterTemperature !== 'all') {
        if (filterTemperature === 'none' && lead.temperature) return false;
        if (filterTemperature !== 'none' && lead.temperature !== filterTemperature) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        return (
          lead.name.toLowerCase().includes(q) ||
          (lead.company || '').toLowerCase().includes(q) ||
          lead.phone.includes(q) ||
          (lead.email || '').toLowerCase().includes(q)
        );
      }
      return true;
    })
    .sort((a, b) => {
      // "Last Called" override — takes precedence over column sort when active
      if (lastCalledSort !== 'default') {
        const aTime = a.lastCalledAt ? new Date(a.lastCalledAt).getTime() : 0;
        const bTime = b.lastCalledAt ? new Date(b.lastCalledAt).getTime() : 0;
        return lastCalledSort === 'recent' ? bTime - aTime : aTime - bTime;
      }
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

  const statusBadge = (status: string) => {
    const styles: Record<string, string> = {
      not_called: 'bg-blue-500/15 text-blue-400',
      called: 'bg-[rgba(10,156,212,0.15)] text-sky-ink',
    };
    return styles[status] || 'bg-tray text-ink-muted';
  };

  const statusLabel = (status: string) => {
    const labels: Record<string, string> = {
      not_called: 'Not Called',
      called: 'Called',
    };
    return labels[status] || status;
  };

  const formatLastCalled = (dateStr: string | null) => {
    if (!dateStr) return '—';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  };

  const temperatureCycle = (current: string | null): 'hot' | 'warm' | 'cold' | null => {
    if (!current) return 'hot';
    if (current === 'hot') return 'warm';
    if (current === 'warm') return 'cold';
    return null;
  };

  const handleTemperatureClick = async (lead: Lead) => {
    const newTemp = temperatureCycle(lead.temperature);
    // Optimistic update
    setLeads((prev) =>
      prev.map((l) => (l.id === lead.id ? { ...l, temperature: newTemp } : l))
    );
    try {
      await api.updateLeadTemperature(lead.id, newTemp);
    } catch (err) {
      console.error('Failed to update temperature:', err);
      // Revert on error
      setLeads((prev) =>
        prev.map((l) => (l.id === lead.id ? { ...l, temperature: lead.temperature } : l))
      );
    }
  };

  const renderTemperatureBadge = (lead: Lead) => {
    const temp = lead.temperature;
    if (!temp) {
      return (
        <button
          onClick={(e) => { e.stopPropagation(); handleTemperatureClick(lead); }}
          className="text-ink-dim text-sm hover:text-ink-muted transition-colors cursor-pointer"
        >
          —
        </button>
      );
    }
    const config = {
      hot: { icon: Flame, color: 'text-red-400', bg: 'bg-red-500/10', label: 'Hot' },
      warm: { icon: Thermometer, color: 'text-amber-400', bg: 'bg-amber-500/10', label: 'Warm' },
      cold: { icon: Snowflake, color: 'text-blue-400', bg: 'bg-blue-500/10', label: 'Cold' },
    }[temp];
    const Icon = config.icon;
    return (
      <button
        onClick={(e) => { e.stopPropagation(); handleTemperatureClick(lead); }}
        className={`${config.bg} ${config.color} text-xs px-2.5 py-1 rounded-full inline-flex items-center gap-1 cursor-pointer hover:opacity-80 transition-opacity`}
      >
        <Icon size={11} />
        {config.label}
      </button>
    );
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
      <div className="mb-8">
        <EyebrowLabel variant="pill" className="mb-4">
          DIRECTORY · LEADS
        </EyebrowLabel>
        <SectionHeading size="section">All leads.</SectionHeading>
        <p className="text-ink-muted text-sm mt-3">
          {leads.length} total &middot; {leads.filter((l) => l.status === 'not_called').length} not called &middot; {leads.filter((l) => l.status === 'called').length} called
        </p>
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

        {/* Status filter */}
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-ink-dim" />
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="bg-paper border border-hair-soft rounded-lg px-3 py-2.5 text-sm text-ink-muted focus:outline-none focus:border-[rgba(10,156,212,0.3)] transition-all"
          >
            <option value="all">All Statuses</option>
            <option value="not_called">Not Called</option>
            <option value="called">Called</option>
          </select>
        </div>

        {/* Temperature filter */}
        <select
          value={filterTemperature}
          onChange={(e) => setFilterTemperature(e.target.value)}
          className="bg-paper border border-hair-soft rounded-lg px-3 py-2.5 text-sm text-ink-muted focus:outline-none focus:border-[rgba(10,156,212,0.3)] transition-all"
        >
          <option value="all">All Temperatures</option>
          <option value="hot">Hot</option>
          <option value="warm">Warm</option>
          <option value="cold">Cold</option>
          <option value="none">No temperature</option>
        </select>

        {/* Last called sort */}
        <select
          value={lastCalledSort}
          onChange={(e) => setLastCalledSort(e.target.value as 'default' | 'recent' | 'oldest')}
          className="bg-paper border border-hair-soft rounded-lg px-3 py-2.5 text-sm text-ink-muted focus:outline-none focus:border-[rgba(10,156,212,0.3)] transition-all"
        >
          <option value="default">Last called: Default</option>
          <option value="recent">Last called: Most recent</option>
          <option value="oldest">Last called: Oldest first</option>
        </select>

        {/* Category filter */}
        {categories.length > 0 && (
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="bg-paper border border-hair-soft rounded-lg px-3 py-2.5 text-sm text-ink-muted focus:outline-none focus:border-[rgba(10,156,212,0.3)] transition-all"
          >
            <option value="all">All Categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        )}
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
              <th className="w-[90px] text-left text-ink-dim text-xs font-medium uppercase tracking-wider px-3 py-3 select-none cursor-pointer hover:text-ink-muted transition-colors" onClick={() => handleSort('status')}>
                <span className="flex items-center gap-1">
                  Status
                  {sortField === 'status' && <ArrowUpDown size={12} className="text-sky-ink" />}
                </span>
              </th>
              <th className="w-[90px] text-left text-ink-dim text-xs font-medium uppercase tracking-wider px-3 py-3 select-none">
                Temp
              </th>
              <th className="w-[110px] text-left text-ink-dim text-xs font-medium uppercase tracking-wider px-3 py-3 select-none cursor-pointer hover:text-ink-muted transition-colors" onClick={() => handleSort('lastCalledAt')}>
                <span className="flex items-center gap-1">
                  Last Called
                  {sortField === 'lastCalledAt' && <ArrowUpDown size={12} className="text-sky-ink" />}
                </span>
              </th>
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
                    {lead.company || ''}{lead.company && lead.phone ? ' \u00b7 ' : ''}{lead.phone}
                    {lead.website && (
                      <>
                        {' \u00b7 '}
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
                  <span className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${statusBadge(lead.status)}`}>
                    {statusLabel(lead.status)}
                  </span>
                </td>
                <td className="px-3 py-3">
                  {renderTemperatureBadge(lead)}
                </td>
                <td className="px-3 py-3 text-ink-muted text-xs whitespace-nowrap">
                  {formatLastCalled(lead.lastCalledAt)}
                </td>
                <td className="px-3 py-3">
                  <button
                    onClick={() => {
                      setCurrentLead(lead);
                      startSession('new');
                      updateCallState('idle');
                      navigate('/dialler');
                    }}
                    className="bg-ink text-white font-bold text-xs rounded-lg px-3 py-1.5 hover:bg-ink/90 transition-all flex items-center gap-1.5"
                  >
                    <Phone size={12} />
                    Call
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div className="text-center py-12 text-ink-dim">
            {search || filterStatus !== 'all' || filterCategory !== 'all'
              ? 'No leads match your filters'
              : 'No leads imported yet'}
          </div>
        )}
      </div>
    </div>
  );
}
