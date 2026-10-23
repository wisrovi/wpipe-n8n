/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        brand: {
          emerald: '#22c55e',
          cyan: '#06b6d4',
          deep: '#030712',
          card: 'rgba(15, 23, 42, 0.75)',
        }
      }
    },
  },
  plugins: [],
}
