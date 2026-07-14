/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Pretendard Variable"', 'Pretendard', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', '"SFMono-Regular"', 'monospace'],
      },
      colors: {
        // Structural dark surfaces used by the camera / instrument mode. A graphite-blue
        // black rather than a pure neutral, so it reads as "device", not "void".
        ink: {
          50: '#F1F3F7',
          100: '#E1E6ED',
          200: '#C0C9D6',
          300: '#94A0B4',
          400: '#6B7488',
          500: '#4E5769',
          600: '#3A4152',
          700: '#2B3140',
          800: '#212631',
          900: '#181C25',
          950: '#10131A',
        },
        // Warm label-stock surface for the printed-report screen.
        paper: {
          DEFAULT: '#FBF8F1',
          100: '#F4EFE3',
          200: '#E9E1CE',
          ink: '#1B1A16',
        },
        // Three trust signals used consistently wherever a value's provenance matters:
        // verified (matched to an official source), estimate (camera/AI guess awaiting
        // confirmation), alert (needs attention now).
        verified: {
          50: '#EAF6F3',
          100: '#CFEBE4',
          300: '#6FBFAE',
          500: '#1F8F7E',
          600: '#187264',
          700: '#14584D',
        },
        estimate: {
          50: '#FBF1E6',
          100: '#F2DDBE',
          300: '#D9A057',
          500: '#B8672E',
          600: '#955120',
          700: '#713D19',
        },
        alert: {
          50: '#FBECEA',
          100: '#F3CFC9',
          300: '#D98177',
          500: '#AB3B32',
          600: '#8A2E27',
          700: '#6B231D',
        },
      },
      fontSize: {
        // Tabular "readout" sizes for the mono numeral treatment.
        gauge: ['3.25rem', { lineHeight: '1', letterSpacing: '-0.02em' }],
        'gauge-lg': ['4rem', { lineHeight: '0.95', letterSpacing: '-0.02em' }],
      },
      boxShadow: {
        instrument: '0 1px 0 0 rgba(255,255,255,0.06) inset, 0 12px 32px -12px rgba(0,0,0,0.6)',
        label: '0 1px 2px rgba(27,26,22,0.06), 0 16px 40px -20px rgba(27,26,22,0.35)',
      },
      animation: {
        'fade-in': 'fadeIn 0.18s ease forwards',
        'reticle-pulse': 'reticlePulse 2.4s ease-in-out infinite',
        'tick-in': 'tickIn 0.24s ease forwards',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: 0, transform: 'translateY(6px)' },
          to: { opacity: 1, transform: 'translateY(0)' },
        },
        reticlePulse: {
          '0%, 100%': { opacity: 0.55 },
          '50%': { opacity: 1 },
        },
        tickIn: {
          from: { opacity: 0, transform: 'scaleY(0.4)' },
          to: { opacity: 1, transform: 'scaleY(1)' },
        },
      },
    },
  },
  plugins: [],
};
