/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { 500: "#5865F2", 600: "#4752c4" },
      },
    },
  },
  plugins: [],
};
