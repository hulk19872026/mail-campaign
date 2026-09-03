/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0B0F14',
        panel: '#131A22',
        raised: '#182029',
        line: '#212B36',
        muted: '#8B97A5',
        soft: '#C7D0DA',
        accent: {
          DEFAULT: '#22C55E',
          soft: '#16351F',
          text: '#08130B',
        },
        warn: '#F5A524',
        danger: '#F04438',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.35), 0 8px 24px -12px rgba(0,0,0,0.6)',
      },
      borderRadius: { xl2: '14px' },
    },
  },
  plugins: [],
};
