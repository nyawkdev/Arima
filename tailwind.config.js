/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,svelte,ts}'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      'pure-black': 'rgb(var(--bg-rgb) / <alpha-value>)',
      'pure-white': 'rgb(var(--fg-rgb) / <alpha-value>)',
      accent: 'var(--accent)',
      'accent-fg': 'var(--accent-fg)',
      surface: 'var(--surface)',
      'surface-2': 'var(--surface-2)',
      dim: 'var(--dim)',
      faint: 'var(--faint)',
      line: 'var(--line)',
      hover: 'var(--hover)'
    },
    boxShadow: {},
    fontFamily: {
      sans: ['"Segoe UI Variable Text"', '"Inter Variable"', 'Inter', '"Segoe UI"', 'system-ui', 'sans-serif']
    },
    extend: {}
  },
  plugins: []
};
