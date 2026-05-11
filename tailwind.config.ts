import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        syne: ['Syne', 'sans-serif'],
        figtree: ['Figtree', 'sans-serif'],
        dmMono: ['DM Mono', 'monospace'],
      },
      colors: {
        // Sidebar dark tokens (sempre escura)
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
        // Main area light mode
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
        primaria: '#059669',
        primariaHover: '#047857',
        info: '#2563eb',
        patrimonio: '#7c3aed',
        erro: '#dc2626',
        cartao: '#d97706',
      },
      borderRadius: {
        DEFAULT: '14px',
        sm: '9px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.04), 0 6px 20px rgba(0,0,0,0.05)',
        hover: '0 2px 6px rgba(0,0,0,0.06), 0 14px 32px rgba(0,0,0,0.08)',
        suave: '0 1px 3px rgba(0,0,0,0.04)',
        media: '0 4px 16px rgba(0,0,0,0.06)',
      },
      transitionDuration: {
        DEFAULT: '200ms',
      },
    },
  },
  plugins: [],
};

export default config;
