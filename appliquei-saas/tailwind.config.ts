/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Sidebar dark premium tokens
        sb: {
          bg: '#0b1410',
          bg2: '#111c17',
          border: '#1c2e24',
          text: '#8aab94',
          textActive: '#f0faf4',
          accent: '#10b981',
          accentDim: 'rgba(16,185,129,0.10)',
          accentBorder: 'rgba(16,185,129,0.22)',
          hover: 'rgba(255,255,255,0.04)',
          groupLabel: '#3d6050',
          footerBg: '#0d1813',
        },
        // Main area light
        main: {
          fundo: '#f2f5f2',
          branco: '#ffffff',
          superficie: '#edf0ed',
          textoPrincipal: '#101e13',
          textoSecundario: '#3b5440',
          textoMutado: '#7a9480',
          borda: '#dfe7e0',
          borda2: '#c4d2c7',
        },
        // Semantic colors
        primaria: {
          DEFAULT: '#059669',
          hover: '#047857',
          bg: '#ecfdf5',
          borda: '#6ee7b7',
          txt: '#065f46',
        },
        info: {
          DEFAULT: '#2563eb',
          bg: '#eff6ff',
          borda: '#bfdbfe',
          txt: '#1e40af',
        },
        patrimonio: {
          DEFAULT: '#7c3aed',
        },
        erro: {
          DEFAULT: '#dc2626',
          bg: '#fef2f2',
          borda: '#fecaca',
          txt: '#991b1b',
        },
        cartao: {
          DEFAULT: '#d97706',
        },
        amber: {
          bg: '#fffbeb',
          borda: '#fde68a',
          txt: '#92400e',
        },
      },
      borderRadius: {
        DEFAULT: '14px',
        sm: '9px',
      },
      fontFamily: {
        syne: ['Syne', 'sans-serif'],
        figtree: ['Figtree', 'sans-serif'],
        mono: ['DM Mono', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.04), 0 6px 20px rgba(0,0,0,0.05)',
        hover: '0 2px 6px rgba(0,0,0,0.06), 0 14px 32px rgba(0,0,0,0.08)',
        suave: '0 1px 3px rgba(0,0,0,0.04)',
        media: '0 4px 16px rgba(0,0,0,0.06)',
      },
    },
  },
  plugins: [],
}
