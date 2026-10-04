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
      fontFamily: { sans: ['Poppins', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
} satisfies Config;
