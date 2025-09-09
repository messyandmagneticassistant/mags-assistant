module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        rose: require('tailwindcss/colors').rose,
        indigo: require('tailwindcss/colors').indigo,
        emerald: require('tailwindcss/colors').emerald,
      },
    },
  },
};
