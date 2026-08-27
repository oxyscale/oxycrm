import { useState, useEffect, useCallback } from 'react';
import { Loader2, X, Pencil, Trash2, Check, AlertTriangle } from 'lucide-react';
import * as api from '../services/api';

/**
 * Every retainer in the business on one screen, with the ones that look
 * wrong pushed to the top.
 *
 * Billing history is append-only, which is what keeps last month's
 * report true when this month's numbers change. The cost of that is
 * mess: a typo, a change recorded twice, a scheduled rise that moved.
 * None of it shows on any one client's page, and all of it feeds
 * monthly revenue. This is where it gets cleaned.
 */

/** Plain descriptions — the flag names are for the code, not for Jordan. */
const FLAG_LABEL: Record<string, string> = {
  same_day: 'another entry on the same day',
  no_change: 'same amount as the one before',
  short_lived: 'replaced within a fortnight',
  zero: 'no amount set',
  scheduled: 'scheduled',
};

const aud = (n: number) =>
  n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });

const day = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric',
  });

export default function RetainerAudit({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getRetainerOverview>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [from, setFrom] = useState('');
  const [working, setWorking] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.getRetainerOverview());
      setError(null);
    } catch {
      setError('Could not load retainers.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const startEdit = (e: api.RetainerEntry) => {
    setEditing(e.id);
    setAmount(String(e.monthlyAmount));
    setFrom(e.effectiveFrom);
  };

  const save = async (leadId: number, id: number) => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(from)) return;
    setWorking(id);
    try {
      await api.updateRetainer(leadId, id, { monthlyAmount: value, effectiveFrom: from });
      setEditing(null);
      await load();
    } catch {
      setError('Could not save that change.');
    } finally {
      setWorking(null);
    }
  };

  const remove = async (leadId: number, e: api.RetainerEntry, clientName: string) => {
    const ok = window.confirm(
      `Delete ${aud(e.monthlyAmount)}/mo from ${day(e.effectiveFrom)} for ${clientName}?\n\n`
      + 'This removes the entry from billing history. Monthly revenue will fall back to '
      + 'whatever entry comes before it.',
    );
    if (!ok) return;
    setWorking(e.id);
    try {
      await api.deleteRetainer(leadId, e.id);
      await load();
    } catch {
      setError('Could not delete that entry.');
    } finally {
      setWorking(null);
    }
  };

  if (!data) {
    return (
      <div className="no-print bg-paper border border-hair-soft rounded-xl p-8 mb-6 flex justify-center">
        <Loader2 size={18} className="animate-spin text-ink-dim" />
      </div>
    );
  }

  return (
    <div className="no-print bg-paper border border-hair-soft rounded-xl p-5 mb-6">
      <div className="flex items-start justify-between gap-4 mb-1">
        <h3 className="text-ink text-sm font-medium">Retainers</h3>
        <button onClick={onClose} className="text-ink-dim hover:text-ink p-1 -mt-1">
          <X size={16} />
        </button>
      </div>
      <p className="text-ink-dim text-xs leading-relaxed mb-4 max-w-[42rem]">
        Every client with a retainer, oldest change first. {aud(data.totalCurrent)} a month in
        total right now.{' '}
        {data.issueCount > 0
          ? `${data.issueCount} ${data.issueCount === 1 ? 'entry looks' : 'entries look'} worth checking.`
          : 'Nothing looks out of place.'}
        {' '}To move a date, edit the entry rather than adding a new one.
      </p>

      {error && <p className="text-risk text-xs mb-3">{error}</p>}

      <div className="space-y-4">
        {data.clients.map((c) => (
          <div key={c.leadId} className="border-t border-hair-soft pt-3">
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <p className="text-ink text-sm font-medium truncate">{c.name}</p>
              <p className="text-ink-muted text-xs flex-shrink-0">
                {c.current > 0 ? `${aud(c.current)}/mo now` : 'nothing billing now'}
                {c.upcoming.length > 0 && (
                  <span className="text-sky-ink">
                    {' '}&rarr; {aud(c.upcoming[0].monthlyAmount)} from {day(c.upcoming[0].effectiveFrom)}
                  </span>
                )}
              </p>
            </div>

            <div className="space-y-1">
              {c.entries.map((e) => {
                const isCurrent = e.effectiveFrom === c.currentFrom && e.monthlyAmount === c.current;
                const problems = e.flags.filter((f) => f !== 'scheduled');
                return (
                  <div key={e.id} className="group/row">
                    {editing === e.id ? (
                      <div className="flex items-center gap-2 py-1">
                        <input
                          type="number" step="0.01" value={amount}
                          onChange={(ev) => setAmount(ev.target.value)}
                          className="w-28 bg-cream border border-hair-soft rounded px-2 py-1 text-xs text-ink focus:outline-none focus:border-[rgba(10,156,212,0.4)]" />
                        <input
                          type="date" value={from}
                          onChange={(ev) => setFrom(ev.target.value)}
                          className="bg-cream border border-hair-soft rounded px-2 py-1 text-xs text-ink focus:outline-none focus:border-[rgba(10,156,212,0.4)]" />
                        <button
                          onClick={() => save(c.leadId, e.id)}
                          disabled={working === e.id}
                          className="text-sky-ink hover:opacity-70 p-1 disabled:opacity-40">
                          {working === e.id
                            ? <Loader2 size={13} className="animate-spin" />
                            : <Check size={13} />}
                        </button>
                        <button onClick={() => setEditing(null)}
                          className="text-ink-dim hover:text-ink text-xs">
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-baseline justify-between gap-3 py-0.5">
                        <p className="text-xs min-w-0">
                          <span className={isCurrent ? 'text-ink font-medium' : 'text-ink-muted'}>
                            {aud(e.monthlyAmount)}
                          </span>
                          <span className="text-ink-dim"> from {day(e.effectiveFrom)}</span>
                          {e.flags.includes('scheduled') && (
                            <span className="text-sky-ink"> · scheduled</span>
                          )}
                          {problems.map((f) => (
                            <span key={f} className="text-[#b45309]">
                              {' '}&middot; {FLAG_LABEL[f] ?? f}
                            </span>
                          ))}
                        </p>
                        <span className="flex items-center gap-1 flex-shrink-0">
                          <button onClick={() => startEdit(e)}
                            className="text-ink-faint hover:text-ink p-1" title="Edit this entry">
                            <Pencil size={12} />
                          </button>
                          <button onClick={() => remove(c.leadId, e, c.name)}
                            disabled={working === e.id}
                            className="text-ink-faint hover:text-risk p-1 disabled:opacity-40"
                            title="Delete this entry">
                            {working === e.id
                              ? <Loader2 size={12} className="animate-spin" />
                              : <Trash2 size={12} />}
                          </button>
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {data.clients.length === 0 && (
          <p className="text-ink-dim text-xs">No retainers recorded yet.</p>
        )}
      </div>

      {data.issueCount > 0 && (
        <div className="flex items-start gap-2.5 mt-5 rounded-lg border border-[rgba(245,158,11,0.25)] bg-[rgba(245,158,11,0.06)] px-3 py-2.5">
          <AlertTriangle size={14} className="text-[#b45309] flex-shrink-0 mt-0.5" />
          <p className="text-[#7c4a06] text-xs leading-relaxed">
            A flag means the entry has an odd shape, not that it is wrong. An amount that really
            did change twice in a week is fine. Check it against what the client actually pays.
          </p>
        </div>
      )}
    </div>
  );
}
