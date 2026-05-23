/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{html,tsx,ts,jsx,js}'],
  theme: {
    extend: {
      colors: {
        overlay: {
          bg: 'rgba(15, 15, 20, 0.92)',
          border: 'rgba(60, 60, 80, 0.8)'
        }
      }
    }
  },
  plugins: []
}
