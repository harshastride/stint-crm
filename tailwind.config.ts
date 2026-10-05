import type { Config } from 'tailwindcss';

const v = (n: string) => `var(--${n})`;
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'), surface: v('surface'), surface2: v('surface2'), line: v('line'), line2: v('line2'),
        text: v('text'), text2: v('text2'), muted: v('muted'), accent: v('accent'), accentText: v('accentText'), accentSoft: v('accentSoft'),
        ink: v('ink'), coral: v('coral'), badBg: v('badBg'), badText: v('badText'), warnBg: v('warnBg'), warnText: v('warnText'),
        goodBg: v('goodBg'), goodText: v('goodText'),
      },
      spacing: { page: 'var(--space-page)', 'page-sm': 'var(--space-page-sm)', section: 'var(--space-section)', card: 'var(--space-card)' },
      borderRadius: { chip: 'var(--radius-sm)', row: 'var(--radius-md)', control: 'var(--radius-lg)', card: 'var(--radius-xl)' },
      boxShadow: { 1: 'var(--shadow-1)', 2: 'var(--shadow-2)', 3: 'var(--shadow-3)' },
      fontFamily: { sans: ['Poppins', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
} satisfies Config;
