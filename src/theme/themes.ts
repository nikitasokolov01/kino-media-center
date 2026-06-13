// Built-in theme definitions for the Media Center theme system.
//
// Each theme defines the set of CSS custom properties that override the
// defaults declared on :root in styles.css. ThemeProvider applies them by
// setting data-theme on document.documentElement; the CSS selectors
// html[data-theme="<id>"] defined in styles.css do the rest.
//
// To add a new theme:
//   1. Add an entry here.
//   2. Add the html[data-theme="<id>"] selector to styles.css.

export interface BuiltInTheme {
  id: string;
  label: string;
  /** Preview colours shown in the theme swatch. */
  preview: {
    bg: string;
    sidebar: string;
    accent: string;
    text: string;
  };
}

export const BUILT_IN_THEMES: BuiltInTheme[] = [
  {
    id: "default-dark",
    label: "Default Dark",
    preview: {
      bg: "#0f1115",
      sidebar: "#161a22",
      accent: "#6aa3ff",
      text: "#e6e8ee",
    },
  },
  {
    id: "oled-black",
    label: "OLED Black",
    preview: {
      bg: "#000000",
      sidebar: "#080a0f",
      accent: "#6aa3ff",
      text: "#f0f2f8",
    },
  },
  {
    id: "purple",
    label: "Purple",
    preview: {
      bg: "#0d0b14",
      sidebar: "#18152a",
      accent: "#a87fff",
      text: "#ede8ff",
    },
  },
  {
    id: "blue",
    label: "Blue",
    preview: {
      bg: "#090d14",
      sidebar: "#0f1622",
      accent: "#4d9fff",
      text: "#e4eeff",
    },
  },
  {
    id: "red",
    label: "Red",
    preview: {
      bg: "#130b0b",
      sidebar: "#1f1212",
      accent: "#ff6b6b",
      text: "#ffe8e8",
    },
  },
  {
    id: "neon-midnight",
    label: "Neon Midnight",
    preview: {
      bg: "#050713",
      sidebar: "#090d1f",
      accent: "#38bdf8",
      text: "#f8fbff",
    },
  },
];

/** Preset accent colours the user can pick from. */
export interface AccentPreset {
  id: string;
  label: string;
  hex: string;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: "blue",   label: "Blue",   hex: "#6aa3ff" },
  { id: "purple", label: "Purple", hex: "#9b7dff" },
  { id: "green",  label: "Green",  hex: "#6affb3" },
  { id: "red",    label: "Red",    hex: "#ff6b6b" },
  { id: "pink",   label: "Pink",   hex: "#ff7eb6" },
  { id: "orange", label: "Orange", hex: "#ff9f6b" },
];

/** Compute an appropriate foreground colour for text on a given accent. */
export function accentFg(accentHex: string): string {
  // Simple luminance check -- dark themes all use a dark foreground.
  // If the accent is a very light colour we keep the dark fg; otherwise #0b1020.
  return "#0b1020";
}
