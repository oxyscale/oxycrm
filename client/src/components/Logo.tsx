interface LogoProps {
  variant?: 'full' | 'stacked';
  className?: string;
}

export default function Logo({ variant = 'full', className = '' }: LogoProps) {
  if (variant === 'stacked') {
    return (
      <div
        className={`font-outfit font-extrabold tracking-[0.16em] leading-tight text-center ${className}`}
      >
        <div className="text-[#fafafa]">OXY</div>
        <div className="text-[#34d399]">SCALE</div>
      </div>
    );
  }

  return (
    <span
      className={`font-outfit font-extrabold tracking-[-0.03em] ${className}`}
    >
      <span className="text-[#fafafa]">Oxy</span>
      <span className="text-[#34d399]">Scale</span>
    </span>
  );
}
