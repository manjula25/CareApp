/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#07111E',
        surface: '#0C1829',
        'surface-hover': '#0F2038',
        'surface-raised': '#132842',
        border: {
          DEFAULT: '#1A3450',
          light: '#244A6A',
        },
        cyan: '#00C8FF',
        red: '#E84848',
        violet: '#8661D4',
        emerald: '#0FC48A',
        amber: '#F0970A',
        text: {
          DEFAULT: '#C8E6F5',
          muted: '#5A8FAA',
          dim: '#2C567A',
        },
      },
      backgroundColor: {
        'cyan-dim': 'rgba(0,200,255,0.10)',
        'red-dim': 'rgba(232,72,72,0.12)',
        'violet-dim': 'rgba(134,97,212,0.12)',
        'emerald-dim': 'rgba(15,196,138,0.12)',
        'amber-dim': 'rgba(240,151,10,0.12)',
      },
      fontFamily: {
        sans: ['-apple-system', 'SF Pro Text', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['SF Mono', 'Menlo', 'Courier New', 'monospace'],
      },
      fontSize: {
        xs: '11px',
        label: '12px',
        body: '13px',
        section: '17px',
        title: '20px',
        stat: '28px',
      },
      borderRadius: {
        card: '8px',
        chip: '4px',
        pill: '20px',
      },
    },
  },
  plugins: [],
};
