const colors = require('tailwindcss/colors');
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        rose: colors.rose,
        indigo: colors.indigo,
        emerald: colors.emerald,
      },
      fontFamily: {
        serif: ['serif'],
        sans: ['ui-sans-serif', 'system-ui'],
      },
    },
  },
  plugins: [],
};
