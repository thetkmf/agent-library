/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        surface: 'rgb(var(--pkb-surface) / <alpha-value>)',
        elevated: 'rgb(var(--pkb-elevated) / <alpha-value>)',
        sunken: 'rgb(var(--pkb-sunken) / <alpha-value>)',
        border: 'rgb(var(--pkb-border) / <alpha-value>)',
        content: 'rgb(var(--pkb-content) / <alpha-value>)',
        muted: 'rgb(var(--pkb-muted) / <alpha-value>)',
        accent: 'rgb(var(--pkb-accent) / <alpha-value>)',
        'accent-strong': 'rgb(var(--pkb-accent-strong) / <alpha-value>)',
        success: 'rgb(var(--pkb-success) / <alpha-value>)',
        warning: 'rgb(var(--pkb-warning) / <alpha-value>)',
        danger: 'rgb(var(--pkb-danger) / <alpha-value>)',
      },
      borderRadius: {
        sm: '4px',
        DEFAULT: '6px',
        md: '8px',
        lg: '12px',
      },
      fontFamily: {
        sans: ['"Segoe UI"', 'system-ui', '"Microsoft YaHei UI"', '"PingFang SC"', 'sans-serif'],
        mono: ['"Cascadia Code"', '"JetBrains Mono"', 'Consolas', 'monospace'],
      },
      transitionDuration: {
        ui: '160ms',
      },
    },
  },
  plugins: [],
};
