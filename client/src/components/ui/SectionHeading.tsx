import type { ReactNode } from 'react';
import EyebrowLabel from './EyebrowLabel';

interface SectionHeadingProps {
  eyebrow?: string;
  accent?: string;            // italic Sky Ink accent word(s)
  accentAfter?: string;       // additional ink text after the accent (e.g. "actually use" + "." )
  size?: 'hero' | 'section' | 'card';
  children: ReactNode;        // the leading ink text before the accent
  className?: string;
}

// Big editorial heading with the signature Fraunces italic Sky Ink accent pattern.
//   <SectionHeading eyebrow="DASHBOARD" accent="actually working">
//     Intelligence your team will
//   </SectionHeading>
// Renders: [eyebrow pill]
//          Intelligence your team will *actually working.*
export default function SectionHeading({
  eyebrow,
  accent,
  accentAfter,
  size = 'section',
  children,
  className = '',
}: SectionHeadingProps) {
  const sizing =
    size === 'hero'
      ? 'text-[56px] md:text-[72px] leading-[1.02] tracking-hero'
      : size === 'card'
        ? 'text-[22px] leading-tight tracking-card'
        : 'text-[34px] md:text-[40px] leading-[1.1] tracking-section';

  return (
    <div className={className}>
      {eyebrow && (
        <div className="mb-5">
          <EyebrowLabel variant="pill">{eyebrow}</EyebrowLabel>
        </div>
      )}
      <h1 className={`font-sans font-semibold text-sky-ink ${sizing}`}>
        {children}
        {accent && (
          <>
            {' '}
            <span>{accent}</span>
          </>
        )}
        {accentAfter && <span>{accentAfter}</span>}
      </h1>
    </div>
  );
}
