import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          bg: '#09090b',
          surface: '#18181b',
          surface2: '#1f1f23',
        },
        emerald: {
          accent: '#34d399',
        },
      },
      fontFamily: {
        geist: ['Geist', 'sans-serif'],
        outfit: ['Outfit', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
