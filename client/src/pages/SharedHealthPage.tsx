import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, Download } from 'lucide-react';

interface SharedReport {
  html: string;
  month: string;
  monthLabel: string;
  expiresAt: string;
}

/**
 * The report as a shareholder sees it. No login, no navigation, no CRM.
 *
 * The document is served as the HTML that was captured when the link was
 * created, so what arrives cannot drift from what was previewed and does
 * not move when the CRM does. Download is the browser's own print
 * engine, which is what makes the PDF look right — no server-side
 * rendering, and the file is produced on their machine.
 */
export default function SharedHealthPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<SharedReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/investor/shared/${token}`);
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(body?.error || 'This link is not valid.');
        } else {
          setData(body as SharedReport);
          document.title = `OxyScale · ${body.monthLabel}`;
        }
      } catch {
        if (!cancelled) setError('Could not load the report. Please try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center">
        <Loader2 size={22} className="animate-spin text-ink-dim" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center p-8">
        <div className="text-center max-w-sm">
          <p className="font-mono text-[10px] font-semibold tracking-[0.22em] uppercase text-ink-dim">
            Oxy<span className="text-sky-ink">Scale</span>
          </p>
          <p className="text-ink text-lg font-medium mt-4">{error}</p>
          <p className="text-ink-muted text-sm mt-2 leading-relaxed">
            Links expire after 30 days. Ask Jordan for a current one.
          </p>
        </div>
      </div>
    );
  }

  const expires = new Date(data.expiresAt).toLocaleDateString('en-AU', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <div className="min-h-screen bg-cream">
      {/* Everything in here is hidden by the print stylesheet. */}
      <div className="no-print sticky top-0 z-10 bg-cream/95 backdrop-blur border-b border-hair-soft">
        <div className="max-w-[900px] mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-[10px] font-semibold tracking-[0.22em] uppercase text-ink-dim">
              Oxy<span className="text-sky-ink">Scale</span> · Business health
            </p>
            <p className="text-ink text-sm font-medium mt-0.5 truncate">{data.monthLabel}</p>
          </div>
          <button
            onClick={() => window.print()}
            className="flex-shrink-0 inline-flex items-center gap-2 bg-ink text-white text-sm font-medium rounded-full px-5 py-2.5 hover:bg-[#1a1d1f] active:scale-[0.98] transition-all"
          >
            <Download size={15} />
            Download PDF
          </button>
        </div>
      </div>

      <div className="print-page-padding px-6 py-8">
        {/* Our own rendered markup, captured after React escaped it. */}
        <div dangerouslySetInnerHTML={{ __html: data.html }} />
      </div>

      <div className="no-print max-w-[900px] mx-auto px-6 pb-10">
        <p className="text-ink-dim text-xs text-center">
          This link expires on {expires}.
        </p>
      </div>
    </div>
  );
}
