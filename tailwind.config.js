/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#14181d', soft: '#3c4653', mute: '#6b7785', faint: '#98a3b0' },
        paper: { DEFAULT: '#fbfbf9', raised: '#ffffff', sunk: '#f2f3ef' },
        line: { DEFAULT: '#e3e5e0', strong: '#c9ccc5' },
        brand: { DEFAULT: '#1f5f4f', soft: '#e7f0ec' },
        hosp: '#1f5f4f',
        school: '#8a5a1f',
        alert: '#a8342a',
      },
      fontFamily: {
        sans: ['Pretendard', 'Pretendard Variable', '-apple-system', 'Malgun Gothic', 'sans-serif'],
        num: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: { '2xs': ['0.6875rem', '1rem'] },
    },
  },
  plugins: [],
}
