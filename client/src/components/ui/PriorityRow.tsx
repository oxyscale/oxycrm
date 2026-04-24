import type { ReactNode } from 'react';

export type PriorityTone = 'risk' | 'warn' | 'sky' | 'neutral';

interface PriorityRowProps {
  tone: PriorityTone;
  tag?: string;              // e.g. "HIGH · SALES · $1.4M region"
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;        // the sky-ink "→ Loop in Stephen..." line
  right?: ReactNode;         // right-aligned block (assignee, date, call button)
  onClick?: () => void;
  className?: string;
}

const tonePalette: Record<PriorityTone, { border: string; tint: string; text: string }> = {
  risk: {
    border: 'border-l-risk',
    tint: 'bg-[rgba(239,68,68,0.04)]',
    text: 'text-risk',
  },
  warn: {
    border: 'border-l-warn',
    tint: 'bg-[rgba(245,158,11,0.05)]',
    text: 'text-warn',
  },
  sky: {
    border: 'border-l-sky-ink',
    tint: 'bg-sky-wash',
    text: 'text-sky-ink',
  },
  neutral: {
    border: 'border-l-hair-strong',
    tint: 'bg-tray',
    text: 'text-ink-dim',
  },
};

// Left-border accent + tinted row, with optional mono tag + sky-ink action line.
// Mirrors the priority rows on oxyscale.ai dashboards.
export default function PriorityRow({
  tone,
  tag,
  title,
  body,
  action,
  right,
  onClick,
  className = '',
}: PriorityRowProps) {
  const palette = tonePalette[tone];
  return (
    <div
      onClick={onClick}
      className={`${palette.tint} ${palette.border} border-l-[3px] rounded-lg rounded-l-sm px-4 py-3.5 flex items-start justify-between gap-4 transition-all ${
        onClick ? 'cursor-pointer hover:brightness-[0.98]' : ''
      } ${className}`}
    >
      <div className="flex-1 min-w-0">
        {tag && (
          <p className={`font-mono text-[10px] font-semibold tracking-[0.2em] uppercase mb-1.5 ${palette.text}`}>
            {tag}
          </p>
        )}
        <div className="text-ink font-medium text-[15px] leading-snug">{title}</div>
        {body && <div className="text-ink-muted text-[13px] leading-snug mt-1">{body}</div>}
        {action && (
          <div className="mt-2 text-sky-ink text-[13px] font-medium inline-flex items-center gap-1.5">
            <span>→</span>
            <span>{action}</span>
          </div>
        )}
      </div>
      {right && <div className="flex items-center gap-3 flex-shrink-0">{right}</div>}
    </div>
  );
}
