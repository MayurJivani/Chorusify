/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Geist Variable', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // Room codes, duel timers and leaderboard figures all run through `font-mono`, which was
        // falling through to whatever the OS supplied. Naming it here keeps those aligned and
        // matched to the sans.
        mono: ['Geist Mono Variable', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        chorusify: {
          bg: '#121214',
          surface: '#1c1c20',
          'surface-2': '#26262b',
          'surface-hover': '#303036',
          accent: '#8b5cf6',
          accent2: '#06b6d4',
          success: '#22c55e',
          danger: '#ef4444',
          muted: '#8e8e93',
        },
      },
      backgroundImage: {
        'hero-glow': 'radial-gradient(ellipse 60% 40% at 50% -10%, rgba(255, 255, 255, 0.05) 0%, transparent 70%)',
      },
      keyframes: {
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%': { transform: 'translateX(-8px)' },
          '40%': { transform: 'translateX(8px)' },
          '60%': { transform: 'translateX(-6px)' },
          '80%': { transform: 'translateX(6px)' },
        },
        'waveform-1': {
          '0%, 100%': { height: '0.5rem' },
          '50%': { height: '2rem' },
        },
        'waveform-2': {
          '0%, 100%': { height: '1.25rem' },
          '50%': { height: '0.5rem' },
        },
        'waveform-3': {
          '0%, 100%': { height: '0.75rem' },
          '50%': { height: '2.5rem' },
        },
        'waveform-4': {
          '0%, 100%': { height: '2rem' },
          '50%': { height: '0.5rem' },
        },
        'waveform-5': {
          '0%, 100%': { height: '0.5rem' },
          '50%': { height: '1.75rem' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'spin-slow': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        shake: 'shake 0.4s ease-in-out',
        'waveform-1': 'waveform-1 1.1s ease-in-out infinite',
        'waveform-2': 'waveform-2 0.9s ease-in-out infinite',
        'waveform-3': 'waveform-3 1.3s ease-in-out infinite',
        'waveform-4': 'waveform-4 0.8s ease-in-out infinite',
        'waveform-5': 'waveform-5 1.0s ease-in-out infinite',
        float: 'float 3s ease-in-out infinite',
        'fade-up': 'fade-up 0.4s ease-out forwards',
        'spin-slow': 'spin-slow 3s linear infinite',
      },
    },
  },
  plugins: [],
};
