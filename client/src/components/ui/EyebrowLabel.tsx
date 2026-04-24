import type { ReactNode } from 'react';

interface EyebrowLabelProps {
  children: ReactNode;
  variant?: 'pill' | 'bare';
  tone?: 'neutral' | 'sky';
  className?: string;
}

// Mono uppercase eyebrow label — "THE PROBLEM", "HOW IT WORKS", "01 LAYER".
// variant="pill" = white rounded-full pill with hair border (above section headings).
// variant="bare" = no chrome, just the mono tracked text (inline above stats / inside cards).
export default function EyebrowLabel({
  children,
  variant = 'pill',
  tone = 'sky',
  className = '',
}: EyebrowLabelProps) {
  const base =
    'inline-flex items-center gap-2 font-mono text-[10.5px] font-bold uppercase tracking-[0.22em] leading-none whitespace-nowrap';

  if (variant === 'pill') {
    return (
      <span
        className={`${base} bg-paper border border-hair-soft rounded-full px-3 py-2 ${
          tone === 'sky' ? 'text-sky-ink' : 'text-ink-dim'
        } ${className}`}
      >
        {children}
      </span>
    );
  }

  return (
    <span className={`${base} ${tone === 'sky' ? 'text-sky-ink' : 'text-ink-dim'} ${className}`}>
      {children}
    </span>
  );
}
