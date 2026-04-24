interface LogoProps {
  variant?: 'full' | 'stacked' | 'inverse';
  className?: string;
}

export default function Logo({ variant = 'full', className = '' }: LogoProps) {
  if (variant === 'stacked') {
    return (
      <div
        className={`font-sans font-semibold tracking-[0.02em] leading-tight text-center ${className}`}
      >
        <div className="text-ink">Oxy</div>
        <div className="text-sky-ink">Scale</div>
      </div>
    );
  }

  if (variant === 'inverse') {
    return (
      <span
        className={`font-sans font-semibold tracking-wordmark ${className}`}
      >
        <span className="text-white">Oxy</span>
        <span className="text-sky">Scale</span>
      </span>
    );
  }

  return (
    <span className={`font-sans font-semibold tracking-wordmark ${className}`}>
      <span className="text-ink">Oxy</span>
      <span className="text-sky-ink">Scale</span>
    </span>
  );
}
