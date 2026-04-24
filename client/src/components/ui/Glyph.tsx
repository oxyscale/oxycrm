interface GlyphProps {
  size?: number;
  pulse?: boolean;
  className?: string;
}

// Breathing ring — outer sky-wash ring, 1.5px sky stroke, solid sky dot centre.
// Signature OxyScale mark. Use as sidebar logo, inline with wordmark, or alone.
export default function Glyph({ size = 20, pulse = false, className = '' }: GlyphProps) {
  const dotSize = Math.max(4, Math.round(size * 0.28));
  return (
    <span
      className={`relative inline-flex items-center justify-center flex-shrink-0 ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span
        className="absolute inset-0 rounded-full"
        style={{
          background: 'rgba(94,197,230,0.12)',
          border: '1.5px solid #5ec5e6',
        }}
      />
      <span
        className={`rounded-full ${pulse ? 'animate-pulse' : ''}`}
        style={{
          width: dotSize,
          height: dotSize,
          backgroundColor: '#5ec5e6',
        }}
      />
    </span>
  );
}
