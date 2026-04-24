import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#0b0d0e',
          muted: '#55606a',
          dim: '#8a95a0',
          faint: '#b8bfc6',
        },
        sky: {
          DEFAULT: '#5ec5e6',
          ink: '#0a9cd4',
          wash: 'rgba(94,197,230,0.14)',
          hair: 'rgba(94,197,230,0.28)',
        },
        cream: '#faf9f5',
        paper: '#ffffff',
        tray: '#f2f0e8',
        hair: {
          DEFAULT: 'rgba(11,13,14,0.08)',
          soft: 'rgba(11,13,14,0.05)',
          strong: 'rgba(11,13,14,0.14)',
        },
        ok: '#10b981',
        warn: '#f59e0b',
        risk: '#ef4444',
      },
      fontFamily: {
        sans: [
          'Geist',
          'Inter',
          'SF Pro Display',
          '-apple-system',
          'BlinkMacSystemFont',
          'system-ui',
          'sans-serif',
        ],
        mono: ['Geist Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        editorial: ['Fraunces', 'Georgia', 'serif'],
      },
      boxShadow: {
        card: '0 30px 80px -40px rgba(11,13,14,0.35)',
        'sky-elevated': '0 12px 28px -18px rgba(12,141,191,0.35)',
        'sky-strong': '0 24px 48px -18px rgba(12,141,191,0.5)',
        'btn-hover': '0 4px 12px -6px rgba(12,141,191,0.3)',
        paper: 'inset 0 1px 0 rgba(255,255,255,0.85)',
      },
      letterSpacing: {
        hero: '-0.04em',
        section: '-0.03em',
        card: '-0.02em',
        wordmark: '-0.035em',
      },
    },
  },
  plugins: [],
};

export default config;
