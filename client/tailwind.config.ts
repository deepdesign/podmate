import type { Config } from 'tailwindcss';

export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#000000',
          dark: '#1a1a1a',
          accent: '#0ea5e9',
        },
      },
    },
  },
  plugins: [],
} satisfies Config;

