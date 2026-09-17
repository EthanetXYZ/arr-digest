/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        addition: "#57F287",
        upgrade: "#5865F2",
        removal: "#ED4245",
      },
    },
  },
  plugins: [],
};
