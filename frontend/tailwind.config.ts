import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "#080B12",
        surface: "#0F141F",
        panel: {
          DEFAULT: "#131A26",
          raised: "#171F2D",
          hover: "#1A2333",
        },
        border: {
          subtle: "#1E2733",
          strong: "#2A3646",
          divider: "#182130",
        },
        text: {
          primary: "#F3F6FB",
          secondary: "#A7B2C3",
          muted: "#6C7789",
          disabled: "#454E5E",
        },
        primary: {
          100: "#DCE3FF",
          300: "#8FA3FF",
          500: "#4F6EF7",
          600: "#3B57DE",
          700: "#2C42B0",
          muted: "#161E3A",
        },
        ai: {
          100: "#E6DEFF",
          300: "#B69AFF",
          500: "#8B5CF6",
          600: "#7440E0",
          700: "#5B2FB3",
          muted: "#211A3D",
        },
        success: {
          100: "#D3FBE9",
          300: "#5FE3AD",
          500: "#10B981",
          600: "#0C9268",
          muted: "#0E241C",
        },
        risk: {
          100: "#FFE1E3",
          300: "#FF8A8F",
          500: "#F5484F",
          600: "#D42F38",
          muted: "#2B1418",
        },
        warning: {
          300: "#FFD37A",
          500: "#F5A623",
          muted: "#2B2110",
        },
        // Marketing site tokens
        paper: {
          DEFAULT: "#FBFAF7",
          alt: "#F3F1EA",
          raised: "#FFFFFF",
        },
        ink: {
          DEFAULT: "#14151A",
          secondary: "#4C505B",
          muted: "#888C96",
        },
        hairline: {
          DEFAULT: "#E6E3D9",
          strong: "#D6D2C4",
        },
        accent: {
          100: "#E7EBFF",
          300: "#9CADFF",
          500: "#4F5EF0",
          600: "#3C46CC",
          violet: "#8B5CF6",
        },
      },
      fontFamily: {
        sans: ["Geist Sans", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["Geist Mono", "IBM Plex Mono", "ui-monospace", "monospace"],
        display: ["var(--font-display)", "Georgia", "serif"],
        marketing: ["var(--font-marketing)", "-apple-system", "Segoe UI", "sans-serif"],
        tabular: ["var(--font-portal-mono)", "IBM Plex Mono", "ui-monospace", "monospace"],
      },
      borderRadius: {
        sm: "6px",
        md: "8px",
        lg: "12px",
        pill: "999px",
      },
      boxShadow: {
        panel: "0 1px 2px rgba(0,0,0,0.24)",
        drawer: "0 8px 32px rgba(0,0,0,0.48)",
      },
    },
  },
  plugins: [],
};

export default config;
