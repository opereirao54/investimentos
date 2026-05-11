/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Cores premium escuras que conversam com o Appliquei v13.0
        'sb-dark': '#0b1410',
        'sb-dark2': '#111c17',
        'sb-border': '#1c2e24',
        'sb-text': '#8aab94',
        'sb-active': '#f0faf4',
        'primary': '#10b981',
        'primary-hover': '#059669',
        'accent': '#047857',
      },
      fontFamily: {
        syne: ['Syne', 'sans-serif'],
        figtree: ['Figtree', 'sans-serif'],
        mono: ['DM Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}
