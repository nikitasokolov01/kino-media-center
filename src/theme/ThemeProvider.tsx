// ThemeProvider reads settings from SettingsContext and applies them to
// document.documentElement so every component inherits the correct CSS
// variable values without extra re-renders.
//
// Channels:
//   1. data-theme attr on html -> CSS selectors in styles.css do the work.
//   2. Inline CSS variable overrides on html.style -> accent-color override.
//   3. style#custom-user-css injected into head -> custom CSS.
//   4. --poster-radius CSS variable -> card/poster corner radius.
//   5. --app-bg-override CSS variable -> background style override.
//
// Security: custom CSS is set via textContent (never innerHTML/eval).
// Remote @import is blocked in the UI. We do NOT evaluate it as code.

import { useEffect, type ReactNode } from "react";
import { useSettings } from "../state/SettingsContext.js";

const CUSTOM_STYLE_ID = "custom-user-css";

interface ThemeProviderProps {
  children: ReactNode;
}

// Poster radius values -> CSS radius values
const POSTER_RADIUS_MAP: Record<string, string> = {
  square: "2px",
  soft: "6px",
  rounded: "12px",
  pill: "24px",
};

// Background style -> CSS background value
function buildBackground(style: string, customColor: string): string | null {
  switch (style) {
    case "oled-black":
      return "#000000";
    case "subtle-gradient":
      return "linear-gradient(135deg, #0a0d14 0%, #111520 100%)";
    case "neon-gradient":
      return "linear-gradient(135deg, #050713 0%, #0d0933 50%, #05130d 100%)";
    case "custom-solid":
      return /^#[0-9a-f]{3,8}$/i.test(customColor.trim())
        ? customColor.trim()
        : null;
    default:
      return null;
  }
}

export default function ThemeProvider({ children }: ThemeProviderProps) {
  const { settings } = useSettings();
  const {
    themeId,
    accentColor,
    customCss,
    posterRadius,
    backgroundStyle,
    customBackgroundColor,
  } = settings;

  // 1. Apply data-theme attribute
  useEffect(() => {
    const root = document.documentElement;
    const validThemes = [
      "default-dark",
      "oled-black",
      "purple",
      "blue",
      "red",
      "neon-midnight",
    ];
    if (themeId && validThemes.includes(themeId)) {
      root.setAttribute("data-theme", themeId);
    } else {
      root.removeAttribute("data-theme");
    }
  }, [themeId]);

  // 2. Apply accent colour override as inline CSS variables on <html>
  useEffect(() => {
    const root = document.documentElement;
    const hex = accentColor.trim();
    if (hex && /^#[0-9a-f]{3,8}$/i.test(hex)) {
      root.style.setProperty("--color-accent", hex);
      root.style.setProperty("--color-accent-hover", hex);
      root.style.setProperty("--accent", hex);
    } else {
      root.style.removeProperty("--color-accent");
      root.style.removeProperty("--color-accent-hover");
      root.style.removeProperty("--accent");
    }
  }, [accentColor]);

  // 3. Apply poster radius
  useEffect(() => {
    const root = document.documentElement;
    const radius = POSTER_RADIUS_MAP[posterRadius] ?? POSTER_RADIUS_MAP["soft"];
    root.style.setProperty("--poster-radius", radius);
  }, [posterRadius]);

  // 4. Apply background style
  useEffect(() => {
    const root = document.documentElement;
    const bg = buildBackground(backgroundStyle, customBackgroundColor);
    if (bg) {
      root.style.setProperty("--app-bg-override", bg);
    } else {
      root.style.removeProperty("--app-bg-override");
    }
  }, [backgroundStyle, customBackgroundColor]);

  // 5. Inject / update custom CSS
  useEffect(() => {
    let el = document.getElementById(CUSTOM_STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = CUSTOM_STYLE_ID;
      document.head.appendChild(el);
    }
    el.textContent = customCss ?? "";
  }, [customCss]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      document.getElementById(CUSTOM_STYLE_ID)?.remove();
      document.documentElement.removeAttribute("data-theme");
    };
  }, []);

  return <>{children}</>;
}
