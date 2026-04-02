/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        // Light theme palette
        surface: {
          DEFAULT: '#fafaf9', // warm white bg
          card: '#ffffff',
          elevated: '#f5f5f4',
        },
        border: {
          DEFAULT: '#e7e5e4',
          muted: '#d6d3d1',
        },
        text: {
          primary: '#18181b', // near black
          secondary: '#52525b',
          muted: '#a1a1aa',
        },
        gold: {
          DEFAULT: '#0891B2',
          light: '#06B6D4',
          dark: '#0E7490', // WCAG-safe teal for text on white (7.1:1)
          muted: '#0891B215', // for subtle backgrounds
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        heading: ['Space Grotesk', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['Space Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};
