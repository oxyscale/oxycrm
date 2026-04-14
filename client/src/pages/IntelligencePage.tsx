import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Brain,
  Phone,
  PhoneOff,
  ThumbsUp,
  ThumbsDown,
  PhoneMissed,
  Voicemail,
  ChevronDown,
  ChevronUp,
  Loader2,
  TrendingUp,
  AlertTriangle,
  Lightbulb,
  Filter,
  Zap,
  Clock,
  Trash2,
  RefreshCw,
  CheckCircle,
} from 'lucide-react';
import * as api from '../services/api';
import type { CallLogWithLead, CallIntelligence, CallIntelligenceStats } from '../types';

type Tab = 'transcripts' | 'analysis';

export default function IntelligencePage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('transcripts');

  // Transcripts state
  const [calls, setCalls] = useState<CallLogWithLead[]>([]);
  const [totalCalls, setTotalCalls] = useState(0);
  const [stats, setStats] = useState<CallIntelligenceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterDisposition, setFilterDisposition] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [expandedCallId, setExpandedCallId] = useState<number | null>(null);
  const [categories, setCategories] = useState<string[]>([]);

  // Re-disposition state
  const [changingDisposition, setChangingDisposition] = useState<number | null>(null);
  const [dispositionSuccess, setDispositionSuccess] = useState<number | null>(null);

  // Analysis state
  const [analyses, setAnalyses] = useState<CallIntelligence[]>([]);
  const [analysing, setAnalysing] = useState(false);
  const [loadingAnalyses, setLoadingAnalyses] = useState(true);

  useEffect(() => {
    loadData();
  }, [filterDisposition, filterCategory]);

  useEffect(() => {
    if (tab === 'analysis') loadAnalyses();
  }, [tab]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [callsRes, statsRes, cats] = await Promise.all([
        api.getIntelligenceCalls({
          disposition: filterDisposition,
          category: filterCategory,
          limit: 100,
        }),
        api.getIntelligenceStats(),
        api.getCategories(),
      ]);
      setCalls(callsRes.calls);
      setTotalCalls(callsRes.total);
      setStats(statsRes);
      setCategories(cats);
    } catch (err) {
      console.error('Failed to load intelligence data:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadAnalyses = async () => {
    setLoadingAnalyses(true);
    try {
      const data = await api.getAnalyses();
      setAnalyses(data);
    } catch (err) {
      console.error('Failed to load analyses:', err);
    } finally {
      setLoadingAnalyses(false);
    }
  };

  const handleRunAnalysis = async () => {
    setAnalysing(true);
    try {
      const result = await api.runAnalysis();
      setAnalyses((prev) => [result, ...prev]);
    } catch (err) {
      console.error('Analysis failed:', err);
      alert(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setAnalysing(false);
    }
  };

  const handleDeleteAnalysis = async (id: number) => {
    try {
      await api.deleteAnalysis(id);
      setAnalyses((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  const handleChangeDisposition = async (callId: number, newDisposition: string) => {
    setChangingDisposition(callId);
    setDispositionSuccess(null);
    try {
      const updated = await api.changeCallDisposition(callId, newDisposition);
      // Update the call in our local state
      setCalls((prev) =>
        prev.map((c) => (c.id === callId ? { ...c, disposition: updated.disposition } : c))
      );
      setDispositionSuccess(callId);
      // Clear success indicator after 3 seconds
      setTimeout(() => setDispositionSuccess(null), 3000);
      // Refresh stats since disposition counts changed
      api.getIntelligenceStats().then(setStats).catch(() => {});
    } catch (err) {
      console.error('Failed to change disposition:', err);
      alert(err instanceof Error ? err.message : 'Failed to change disposition');
    } finally {
      setChangingDisposition(null);
    }
  };

  const dispositionIcon = (disposition: string) => {
    switch (disposition) {
      case 'interested': return <ThumbsUp size={14} className="text-[#34d399]" />;
      case 'not_interested': return <ThumbsDown size={14} className="text-red-400" />;
      case 'no_answer': return <PhoneMissed size={14} className="text-amber-400" />;
      case 'voicemail': return <Voicemail size={14} className="text-blue-400" />;
      default: return <Phone size={14} className="text-[#52525b]" />;
    }
  };

  const dispositionLabel = (disposition: string) => {
    const labels: Record<string, string> = {
      interested: 'Interested',
      not_interested: 'Not Interested',
      no_answer: 'No Answer',
      voicemail: 'Voicemail',
      wrong_number: 'Wrong Number',
    };
    return labels[disposition] || disposition;
  };

  const dispositionBadge = (disposition: string) => {
    const styles: Record<string, string> = {
      interested: 'bg-[rgba(52,211,153,0.15)] text-[#34d399]',
      not_interested: 'bg-red-500/15 text-red-400',
      no_answer: 'bg-amber-500/15 text-amber-400',
      voicemail: 'bg-blue-500/15 text-blue-400',
    };
    return styles[disposition] || 'bg-[#1f1f23] text-[#a1a1aa]';
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return '--';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[#fafafa] text-2xl font-bold tracking-tight flex items-center gap-3">
            <Brain size={24} className="text-[#34d399]" />
            Call Intelligence
          </h1>
          <p className="text-[#a1a1aa] text-sm mt-1">
            Analyse call transcripts to refine your offer and improve conversions
          </p>
        </div>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-5 gap-4 mb-6">
          <div className="bg-[#18181b] border border-white/[0.06] rounded-xl p-4">
            <p className="text-[#52525b] text-xs font-medium uppercase tracking-wider mb-1">Total Calls</p>
            <p className="text-[#fafafa] text-2xl font-bold">{stats.totalCalls}</p>
          </div>
          <div className="bg-[#18181b] border border-white/[0.06] rounded-xl p-4">
            <p className="text-[#52525b] text-xs font-medium uppercase tracking-wider mb-1">Interested</p>
            <p className="text-[#34d399] text-2xl font-bold">{stats.interestedCalls}</p>
          </div>
          <div className="bg-[#18181b] border border-white/[0.06] rounded-xl p-4">
            <p className="text-[#52525b] text-xs font-medium uppercase tracking-wider mb-1">Not Interested</p>
            <p className="text-red-400 text-2xl font-bold">{stats.notInterestedCalls}</p>
          </div>
          <div className="bg-[#18181b] border border-white/[0.06] rounded-xl p-4">
            <p className="text-[#52525b] text-xs font-medium uppercase tracking-wider mb-1">Conversion</p>
            <p className="text-[#fafafa] text-2xl font-bold">{stats.conversionRate}%</p>
          </div>
          <div className="bg-[#18181b] border border-white/[0.06] rounded-xl p-4">
            <p className="text-[#52525b] text-xs font-medium uppercase tracking-wider mb-1">Avg Duration</p>
            <p className="text-[#fafafa] text-2xl font-bold">{formatDuration(stats.avgCallDuration)}</p>
          </div>
        </div>
      )}

      {/* Tab toggle */}
      <div className="flex items-center gap-1 mb-6 bg-[#18181b] border border-white/[0.06] rounded-lg p-1 w-fit">
        <button
          onClick={() => setTab('transcripts')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
            tab === 'transcripts'
              ? 'bg-[rgba(52,211,153,0.15)] text-[#34d399]'
              : 'text-[#52525b] hover:text-[#a1a1aa]'
          }`}
        >
          <span className="flex items-center gap-2">
            <Phone size={14} />
            All Transcripts ({totalCalls})
          </span>
        </button>
        <button
          onClick={() => setTab('analysis')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
            tab === 'analysis'
              ? 'bg-[rgba(52,211,153,0.15)] text-[#34d399]'
              : 'text-[#52525b] hover:text-[#a1a1aa]'
          }`}
        >
          <span className="flex items-center gap-2">
            <Brain size={14} />
            AI Analysis
          </span>
        </button>
      </div>

      {/* ── Transcripts Tab ──────────────────────────────────── */}
      {tab === 'transcripts' && (
        <>
          {/* Filters */}
          <div className="flex items-center gap-3 mb-6">
            <Filter size={14} className="text-[#52525b]" />
            <select
              value={filterDisposition}
              onChange={(e) => setFilterDisposition(e.target.value)}
              className="bg-[#18181b] border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-[#a1a1aa] focus:outline-none focus:border-[rgba(52,211,153,0.3)] transition-all"
            >
              <option value="all">All Dispositions</option>
              <option value="interested">Interested</option>
              <option value="not_interested">Not Interested</option>
              <option value="no_answer">No Answer</option>
              <option value="voicemail">Voicemail</option>
            </select>
            {categories.length > 0 && (
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="bg-[#18181b] border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-[#a1a1aa] focus:outline-none focus:border-[rgba(52,211,153,0.3)] transition-all"
              >
                <option value="all">All Categories</option>
                {categories.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            )}
            <span className="text-[#52525b] text-sm ml-auto">
              {calls.length} of {totalCalls} calls
            </span>
          </div>

          {/* Call list */}
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={24} className="animate-spin text-[#52525b]" />
            </div>
          ) : calls.length === 0 ? (
            <div className="text-center py-16">
              <Phone size={32} className="text-[#52525b] mx-auto mb-3" />
              <p className="text-[#52525b] text-sm">No call transcripts yet</p>
              <p className="text-[#52525b] text-xs mt-1">Make some calls and they'll show up here</p>
            </div>
          ) : (
            <div className="space-y-3">
              {calls.map((call) => {
                const isExpanded = expandedCallId === call.id;
                return (
                  <div
                    key={call.id}
                    className="bg-[#18181b] border border-white/[0.06] rounded-xl overflow-hidden"
                  >
                    <button
                      onClick={() => setExpandedCallId(isExpanded ? null : call.id)}
                      className="w-full px-5 py-4 flex items-center gap-4 hover:bg-white/[0.02] transition-all text-left"
                    >
                      {dispositionIcon(call.disposition)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-0.5">
                          <span
                            className="text-[#fafafa] text-sm font-medium truncate hover:text-[#34d399] cursor-pointer transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/leads/${call.leadId}`);
                            }}
                          >
                            {call.leadName}
                          </span>
                          <span className="text-[#52525b] text-xs truncate">
                            {call.leadCompany || ''}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <span className="text-[#52525b]">{formatDate(call.createdAt)}</span>
                          <span className="text-[#52525b] flex items-center gap-1">
                            <Clock size={10} />
                            {formatDuration(call.duration)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {call.leadCategory && (
                          <span className="bg-[rgba(52,211,153,0.1)] text-[#34d399] text-[10px] px-2 py-0.5 rounded-full">
                            {call.leadCategory}
                          </span>
                        )}
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${dispositionBadge(call.disposition)}`}>
                          {dispositionLabel(call.disposition)}
                        </span>
                        {isExpanded ? (
                          <ChevronUp size={14} className="text-[#52525b]" />
                        ) : (
                          <ChevronDown size={14} className="text-[#52525b]" />
                        )}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-5 pb-5 border-t border-white/[0.06]">
                        {call.summary && (
                          <div className="mt-4 mb-3">
                            <h4 className="text-[#52525b] text-xs font-medium uppercase tracking-wider mb-1.5">Summary</h4>
                            <p className="text-[#a1a1aa] text-sm leading-relaxed">{call.summary}</p>
                          </div>
                        )}
                        {call.keyTopics.length > 0 && (
                          <div className="mb-3">
                            <h4 className="text-[#52525b] text-xs font-medium uppercase tracking-wider mb-1.5">Key Topics</h4>
                            <div className="flex flex-wrap gap-1.5">
                              {call.keyTopics.map((topic, i) => (
                                <span key={i} className="bg-[#1f1f23] text-[#a1a1aa] text-xs px-2 py-0.5 rounded-full">{topic}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {call.transcript && (
                          <div className="mt-3">
                            <h4 className="text-[#52525b] text-xs font-medium uppercase tracking-wider mb-1.5">Full Transcript</h4>
                            <div className="bg-[#1f1f23] rounded-lg p-4 max-h-60 overflow-y-auto">
                              <p className="text-[#a1a1aa] text-sm whitespace-pre-wrap leading-relaxed font-mono">
                                {call.transcript}
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Change Disposition */}
                        <div className="mt-4 pt-4 border-t border-white/[0.06]">
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-1.5 text-[#52525b]">
                              <RefreshCw size={12} />
                              <span className="text-xs font-medium uppercase tracking-wider">Change Disposition</span>
                            </div>

                            {dispositionSuccess === call.id && (
                              <span className="flex items-center gap-1 text-[#34d399] text-xs">
                                <CheckCircle size={12} />
                                Updated
                              </span>
                            )}
                          </div>
                          <div className="flex gap-2 mt-2">
                            {[
                              { key: 'interested', label: 'Interested', Icon: ThumbsUp, color: 'text-[#34d399]' },
                              { key: 'not_interested', label: 'Not Interested', Icon: ThumbsDown, color: 'text-red-400' },
                              { key: 'no_answer', label: 'No Answer', Icon: PhoneMissed, color: 'text-amber-400' },
                              { key: 'voicemail', label: 'Voicemail', Icon: Voicemail, color: 'text-blue-400' },
                              { key: 'wrong_number', label: 'Wrong Number', Icon: PhoneOff, color: 'text-[#a1a1aa]' },
                            ]
                              .filter((d) => d.key !== call.disposition)
                              .map(({ key, label, Icon, color }) => (
                                <button
                                  key={key}
                                  onClick={() => handleChangeDisposition(call.id, key)}
                                  disabled={changingDisposition === call.id}
                                  className="flex items-center gap-1.5 bg-[#1f1f23] border border-white/[0.06] rounded-lg px-3 py-1.5 text-xs text-[#a1a1aa] hover:bg-white/[0.04] hover:text-[#fafafa] transition-all disabled:opacity-40"
                                >
                                  {changingDisposition === call.id ? (
                                    <Loader2 size={12} className="animate-spin" />
                                  ) : (
                                    <Icon size={12} className={color} />
                                  )}
                                  {label}
                                </button>
                              ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── Analysis Tab ─────────────────────────────────────── */}
      {tab === 'analysis' && (
        <>
          {/* Run Analysis button + category filter */}
          <div className="mb-6 flex items-center gap-4">
            <button
              onClick={handleRunAnalysis}
              disabled={analysing || (stats?.totalCalls || 0) === 0}
              className="bg-[#34d399] text-[#09090b] font-bold rounded-xl px-6 py-3 hover:bg-[#34d399]/90 transition-all flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-emerald-500/20"
            >
              {analysing ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Analysing calls...
                </>
              ) : (
                <>
                  <Zap size={18} />
                  Run AI Analysis on All Calls
                </>
              )}
            </button>
            {(stats?.totalCalls || 0) === 0 && (
              <p className="text-[#52525b] text-xs mt-2">Make some calls first to enable analysis</p>
            )}
          </div>

          {/* Analyses list */}
          {loadingAnalyses ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={24} className="animate-spin text-[#52525b]" />
            </div>
          ) : analyses.length === 0 ? (
            <div className="text-center py-16">
              <Brain size={32} className="text-[#52525b] mx-auto mb-3" />
              <p className="text-[#52525b] text-sm">No analyses yet</p>
              <p className="text-[#52525b] text-xs mt-1">Run your first analysis to get insights</p>
            </div>
          ) : (
            <div className="space-y-6">
              {analyses.map((analysis) => (
                <div
                  key={analysis.id}
                  className="bg-[#18181b] border border-white/[0.06] rounded-xl overflow-hidden"
                >
                  {/* Analysis header */}
                  <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between">
                    <div>
                      <h3 className="text-[#fafafa] text-sm font-bold flex items-center gap-2">
                        <Brain size={14} className="text-[#34d399]" />
                        Analysis — {formatDate(analysis.createdAt)}
                      </h3>
                      <p className="text-[#52525b] text-xs mt-0.5">
                        {analysis.totalCallsAnalysed} calls analysed
                      </p>
                    </div>
                    <button
                      onClick={() => handleDeleteAnalysis(analysis.id)}
                      className="text-[#52525b] hover:text-red-400 transition-all p-1"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  <div className="p-6 grid grid-cols-3 gap-6">
                    {/* Common Objections */}
                    <div>
                      <h4 className="text-red-400 text-xs font-bold uppercase tracking-wider mb-3 flex items-center gap-2">
                        <AlertTriangle size={12} />
                        Common Objections
                      </h4>
                      {analysis.commonObjections.length > 0 ? (
                        <ul className="space-y-2">
                          {analysis.commonObjections.map((obj, i) => (
                            <li key={i} className="text-[#a1a1aa] text-sm leading-relaxed flex gap-2">
                              <span className="text-red-400 mt-0.5 flex-shrink-0">&bull;</span>
                              {obj}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[#52525b] text-sm italic">No objections identified</p>
                      )}
                    </div>

                    {/* Winning Patterns */}
                    <div>
                      <h4 className="text-[#34d399] text-xs font-bold uppercase tracking-wider mb-3 flex items-center gap-2">
                        <TrendingUp size={12} />
                        What's Working
                      </h4>
                      {analysis.winningPatterns.length > 0 ? (
                        <ul className="space-y-2">
                          {analysis.winningPatterns.map((win, i) => (
                            <li key={i} className="text-[#a1a1aa] text-sm leading-relaxed flex gap-2">
                              <span className="text-[#34d399] mt-0.5 flex-shrink-0">&bull;</span>
                              {win}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[#52525b] text-sm italic">No patterns identified yet</p>
                      )}
                    </div>

                    {/* Recommendations */}
                    <div>
                      <h4 className="text-amber-400 text-xs font-bold uppercase tracking-wider mb-3 flex items-center gap-2">
                        <Lightbulb size={12} />
                        Recommendations
                      </h4>
                      {analysis.recommendations.length > 0 ? (
                        <ul className="space-y-2">
                          {analysis.recommendations.map((rec, i) => (
                            <li key={i} className="text-[#a1a1aa] text-sm leading-relaxed flex gap-2">
                              <span className="text-amber-400 mt-0.5 flex-shrink-0">&bull;</span>
                              {rec}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[#52525b] text-sm italic">No recommendations yet</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
