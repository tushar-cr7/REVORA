import type { Config } from "tailwindcss";

/**
 * REVORA visual foundation — "dark financial infrastructure".
 *
 * This file is the single source of truth for every dashboard token.
 * globals.css reads these values through theme(), so nothing is declared twice.
 *
 * Surface hierarchy (neutral graphite, deliberately NOT blue-black):
 *   L0 canvas        page background
 *   L1 surface/panel system surfaces (sidebar, header, cards, tables)
 *   L2 panel.raised  elevated: popovers, selected rows, drawers
 *   L3 panel.focus   focused / selected surface
 *   L4 *-muted       critical / attention surface (semantic tint, never neutral)
 *
 * Blue (`primary`) is for actions, active/selected state and system signals.
 * It is not a surface colour and not a decoration colour.
 *
 * Semantics: violet = intelligence · green = recovered · red = risk/blocked ·
 * amber = human attention · blue = system / active interaction.
 */
const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── Surfaces ────────────────────────────────────────────────
        canvas: "#080A0D",
        surface: "#0D1117",
        panel: {
          DEFAULT: "#11161D",
          raised: "#151B23",
          hover: "#1A212B",
          focus: "#1B2331",
        },
        // ── Borders: neutral, quiet by default ──────────────────────
        border: {
          subtle: "#252C36",
          strong: "#343D4A",
          divider: "#1A2028",
        },
        // ── Text ────────────────────────────────────────────────────
        text: {
          primary: "#F1F4F7",
          secondary: "#8B95A3",
          muted: "#6C7685",
          disabled: "#444C58",
        },
        // ── System / active interaction ─────────────────────────────
        primary: {
          100: "#E1E9FF",
          200: "#C3D3FF",
          300: "#9DB6FF",
          400: "#7599FF",
          500: "#4F7CFF",
          600: "#3A64E6",
          700: "#2C4DB8",
          800: "#213B8C",
          900: "#172B6B",
          muted: "#111A2F",
        },
        // ── Intelligence (literal AI reasoning / recommendation only) ─
        ai: {
          100: "#EDE7FF",
          200: "#D9CCFF",
          300: "#BDA4FF",
          400: "#A47FFB",
          500: "#8B5CF6",
          600: "#7545DE",
          700: "#5B34B3",
          800: "#442888",
          900: "#34206B",
          muted: "#1A1530",
        },
        // ── Recovered / success / satisfied control ─────────────────
        success: {
          100: "#D6FBEA",
          200: "#A6F0CF",
          300: "#6EE0B0",
          400: "#34CF96",
          500: "#10B981",
          600: "#0C9468",
          700: "#0A7552",
          900: "#0A3D2D",
          950: "#062219",
          muted: "#0C1F19",
        },
        // ── Risk / blocked / policy violation ───────────────────────
        risk: {
          100: "#FFE3E5",
          200: "#FFC4C7",
          300: "#FF9498",
          400: "#FA6A70",
          500: "#F5484F",
          600: "#D63037",
          700: "#AE2329",
          900: "#5C171B",
          muted: "#241216",
        },
        // ── Attention / paused / human review ───────────────────────
        warning: {
          100: "#FFF1CC",
          200: "#FFE2A0",
          300: "#FFD37A",
          400: "#F9B93E",
          500: "#F5A623",
          600: "#D4880F",
          700: "#A8680A",
          900: "#4F3407",
          muted: "#241B0E",
        },
        // ── Marketing site tokens (separate light surface, untouched) ─
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
        // Geist is loaded in app/layout.tsx and exposed as these variables.
        sans: ["var(--font-geist-sans)", "ui-sans-serif", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", "Cascadia Mono", "Consolas", "monospace"],
        // Dashboard: display = Geist Sans (set in globals.css). The marketing
        // layout overrides --font-display with its own serif.
        display: ["var(--font-display)", "var(--font-geist-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        marketing: ["var(--font-marketing)", "-apple-system", "Segoe UI", "sans-serif"],
        tabular: ["var(--font-portal-mono)", "var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        // Metadata tier: labels, timestamps, IDs. Between Tailwind's arbitrary 9.5/10/11 px usages.
        "2xs": ["10px", { lineHeight: "14px", letterSpacing: "0.01em" }],
      },
      // Tighter, more engineered radii than the Tailwind defaults.
      borderRadius: {
        sm: "3px",
        DEFAULT: "4px",
        md: "5px",
        lg: "7px",
        xl: "9px",
        "2xl": "12px",
        pill: "999px",
      },
      // Elevation is expressed as a 1px top-edge light + a tight contact shadow,
      // never as a coloured glow.
      boxShadow: {
        sm: "0 1px 2px rgba(0,0,0,0.35)",
        md: "0 4px 12px -2px rgba(0,0,0,0.45)",
        panel: "inset 0 1px 0 rgba(255,255,255,0.03), 0 1px 2px rgba(0,0,0,0.4)",
        raised: "inset 0 1px 0 rgba(255,255,255,0.045), 0 2px 8px -2px rgba(0,0,0,0.5)",
        drawer: "0 16px 48px -8px rgba(0,0,0,0.62), 0 0 0 1px rgba(255,255,255,0.045)",
        // NB: not named `hairline` — that is also a (marketing) colour token, and
        // Tailwind recolours a shadow whose name matches a colour.
        edge: "inset 0 0 0 1px rgba(255,255,255,0.04)",
      },
    },
  },
  plugins: [],
};

export default config;
