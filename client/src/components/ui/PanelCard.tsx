import type { ReactNode } from 'react';
import EyebrowLabel from './EyebrowLabel';

interface PanelCardProps {
  eyebrow?: string;
  title?: ReactNode;
  right?: ReactNode;
  padded?: boolean;
  elevated?: boolean;
  children: ReactNode;
  className?: string;
}

// Main panel card. White paper on cream, hair-soft border.
// When elevated, adds the sky-elevated halo the website uses on dashboard frames.
// Header supports: mono eyebrow + heading + right-aligned action slot.
export default function PanelCard({
  eyebrow,
  title,
  right,
  padded = true,
  elevated = false,
  children,
  className = '',
}: PanelCardProps) {
  return (
    <section
      className={`bg-paper rounded-2xl border transition-all ${
        elevated
          ? 'border-sky-hair shadow-sky-elevated'
          : 'border-hair-soft'
      } ${className}`}
    >
      {(eyebrow || title || right) && (
        <header
          className={`flex items-center justify-between gap-4 ${padded ? 'px-6 pt-6 pb-4' : ''}`}
        >
          <div className="flex items-center gap-3 min-w-0">
            {eyebrow && <EyebrowLabel variant="bare">{eyebrow}</EyebrowLabel>}
            {title && (
              <h2 className="text-ink font-medium text-[17px] tracking-card truncate">
                {title}
              </h2>
            )}
          </div>
          {right && <div className="flex items-center gap-2 flex-shrink-0">{right}</div>}
        </header>
      )}
      <div className={padded ? 'px-6 pb-6' : ''}>{children}</div>
    </section>
  );
}
