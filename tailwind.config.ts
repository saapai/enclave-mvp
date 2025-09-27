import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Primary (Blue)
        blue: {
          50: '#EEF2FF',
          400: '#60A5FA',
          500: '#3B82F6',
          600: '#2563EB',
          700: '#1D4ED8',
        },
        // Highlight (Red)
        red: {
          500: '#EF4444',
          600: '#DC2626',
        },
        // Surfaces
        surface: {
          bg: '#0B0C0E',
          panel: 'rgba(255,255,255,0.05)',
          'panel-2': 'rgba(255,255,255,0.08)',
          line: 'rgba(255,255,255,0.10)',
        },
        // Text
        text: {
          primary: '#FFFFFF',
          muted: 'rgba(255,255,255,0.65)',
          subtle: 'rgba(255,255,255,0.45)',
        },
      },
      boxShadow: {
        'glow-blue': '0 0 0 1px rgba(59,130,246,0.25)',
        'glow-red': '0 0 0 1px rgba(239,68,68,0.25)',
      },
      fontFamily: {
        sans: ['var(--font-geist)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
