import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';

interface PillButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'outline' | 'ghost' | 'sky';
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  trailing?: ReactNode | 'arrow' | 'none';
  children: ReactNode;
}

// Signature OxyScale CTA — dark Ink pill with white text + trailing arrow in a small
// white-tinted circle. Three variants cover 99% of cases.
export default function PillButton({
  variant = 'primary',
  size = 'md',
  icon,
  trailing = 'arrow',
  className = '',
  children,
  disabled,
  ...rest
}: PillButtonProps) {
  const sizing =
    size === 'sm'
      ? 'px-3.5 py-1.5 text-xs gap-2'
      : size === 'lg'
        ? 'px-6 py-3 text-[15px] gap-3'
        : 'px-5 py-2.5 text-sm gap-2.5';

  const trailingSize = size === 'sm' ? 14 : size === 'lg' ? 18 : 16;
  const trailingBox = size === 'sm' ? 'w-5 h-5' : size === 'lg' ? 'w-7 h-7' : 'w-6 h-6';

  const palettes = {
    primary: {
      base: 'bg-ink text-white hover:bg-[#1a1d1f] active:scale-[0.98]',
      trailing: 'bg-white/15',
    },
    outline: {
      base: 'bg-paper border border-hair text-ink hover:bg-sky-wash hover:border-sky-hair',
      trailing: 'bg-tray',
    },
    ghost: {
      base: 'text-ink-muted hover:text-ink hover:bg-[rgba(11,13,14,0.04)]',
      trailing: 'bg-[rgba(11,13,14,0.06)]',
    },
    sky: {
      base: 'bg-sky-ink text-white hover:brightness-110 active:scale-[0.98]',
      trailing: 'bg-white/20',
    },
  } as const;

  const palette = palettes[variant];

  const trailingNode =
    trailing === 'none'
      ? null
      : trailing === 'arrow'
        ? (
            <span
              className={`${trailingBox} ${palette.trailing} rounded-full inline-flex items-center justify-center flex-shrink-0`}
            >
              <ArrowUpRight size={trailingSize - 4} strokeWidth={2.25} />
            </span>
          )
        : trailing;

  return (
    <button
      {...rest}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-full font-medium tracking-tight transition-all ${sizing} ${palette.base} ${
        disabled ? 'opacity-40 cursor-not-allowed hover:bg-ink hover:brightness-100' : ''
      } ${className}`}
    >
      {icon}
      <span className="leading-none">{children}</span>
      {trailingNode}
    </button>
  );
}
