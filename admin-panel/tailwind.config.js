/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0a0a0b',
        panel: '#131316',
        border: '#26262b',
        ink: '#f5f5f7',
        muted: '#8a8a93',
        primary: '#ffd60a',
        primaryDark: '#e0bb00',
        success: '#22c55e',
        danger: '#ef4444',
        info: '#3b82f6',
      },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui'] },
    },
  },
  plugins: [],
};
