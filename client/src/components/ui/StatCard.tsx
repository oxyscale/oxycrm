import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import EyebrowLabel from './EyebrowLabel';

interface StatCardProps {
  eyebrow: string;
  value: ReactNode;
  sub?: ReactNode;
  subTone?: 'neutral' | 'ok' | 'warn' | 'risk' | 'sky';
  icon?: ReactNode;          // rendered in a small sky-wash tile
  onClick?: () => void;
  elevated?: boolean;        // adds sky-elevated shadow + sky-hair border
  className?: string;
}

const subToneClasses: Record<NonNullable<StatCardProps['subTone']>, string> = {
  neutral: 'text-ink-dim',
  ok: 'text-ok',
  warn: 'text-warn',
  risk: 'text-risk',
  sky: 'text-sky-ink',
};

// Dashboard stat card in the OxyScale website style:
//   MONO EYEBROW
//   $3.87M           [icon tile]
//   +12% vs 12w
export default function StatCard({
  eyebrow,
  value,
  sub,
  subTone = 'neutral',
  icon,
  onClick,
  elevated = false,
  className = '',
}: StatCardProps) {
  const interactive = Boolean(onClick);

  return (
    <div
      onClick={onClick}
      className={`group relative bg-paper rounded-2xl p-5 transition-all ${
        elevated
          ? 'border border-sky-hair shadow-sky-elevated'
          : 'border border-hair-soft'
      } ${interactive ? 'cursor-pointer hover:border-sky-hair hover:shadow-sky-elevated' : ''} ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <EyebrowLabel variant="bare">{eyebrow}</EyebrowLabel>
        {icon && (
          <div className="w-8 h-8 rounded-lg bg-sky-wash flex items-center justify-center text-sky-ink flex-shrink-0">
            {icon}
          </div>
        )}
        {!icon && interactive && (
          <ChevronRight
            size={16}
            className="text-ink-faint group-hover:text-sky-ink transition-colors"
          />
        )}
      </div>
      <p className="mt-3 text-ink font-medium text-[34px] leading-none tracking-tight">
        {value}
      </p>
      {sub && (
        <p className={`mt-2 font-mono text-[11px] tracking-wide ${subToneClasses[subTone]}`}>
          {sub}
        </p>
      )}
    </div>
  );
}
