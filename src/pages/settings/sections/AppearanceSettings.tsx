// Settings > Appearance: theme cards, circular accent swatches, poster
// roundness, background style, and custom CSS section.
// All changes apply immediately via ThemeProvider CSS variable injection.

import { useEffect, useRef, useState } from "react";
import { useSettings } from "../../../state/SettingsContext.js";
import { BUILT_IN_THEMES, ACCENT_PRESETS } from "../../../theme/themes.js";

// Poster radius presets
const POSTER_RADIUS_OPTIONS = [
  { id: "square",  label: "Square",  radius: "2px" },
  { id: "soft",    label: "Soft",    radius: "6px" },
  { id: "rounded", label: "Rounded", radius: "12px" },
  { id: "pill",    label: "Pill",    radius: "24px" },
] as const;

// Background style presets
const BG_STYLE_OPTIONS = [
  { id: "",               label: "Default",   preview: "var(--color-bg, #0f1115)" },
  { id: "oled-black",     label: "OLED Black",   preview: "#000000" },
  { id: "subtle-gradient", label: "Subtle\nGrad", preview: "linear-gradient(135deg, #0a0d14 0%, #111520 100%)" },
  { id: "neon-gradient",  label: "Neon\nGrad",  preview: "linear-gradient(135deg, #050713 0%, #0d0933 50%, #05130d 100%)" },
  { id: "custom-solid",   label: "Custom\nColor", preview: "repeating-linear-gradient(45deg, #444 0px, #444 2px, #333 2px, #333 8px)" },
] as const;

export default function AppearanceSettings() {
  const { settings, update } = useSettings();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [customCssInput, setCustomCssInput] = useState(settings.customCss);
  const [accentHexInput, setAccentHexInput] = useState(settings.accentColor);
  const [bgColorInput, setBgColorInput] = useState(settings.customBackgroundColor);
  const customCssSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setCustomCssInput(settings.customCss); }, [settings.customCss]);
  useEffect(() => { setAccentHexInput(settings.accentColor); }, [settings.accentColor]);
  useEffect(() => { setBgColorInput(settings.customBackgroundColor); }, [settings.customBackgroundColor]);

  async function save(patch: Parameters<typeof update>[0]) {
    setSaveError(null);
    try {
      await update(patch);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }

  const currentTheme = settings.themeId || "default-dark";
  const currentRadius = settings.posterRadius || "soft";
  const currentBgStyle = settings.backgroundStyle ?? "";

  return (
    <div className="settings-panel">
      <h2 className="settings-panel__title">Appearance</h2>
      <p className="muted small">
        Changes apply instantly without a restart.
      </p>

      {saveError && (
        <div className="error-banner">Could not save: {saveError}</div>
      )}

      {/* --- A. Theme Presets --- */}
      <section className="settings-section">
        <h3 className="settings-section__label">Theme</h3>
        <div className="appearance-themes">
          {BUILT_IN_THEMES.map((theme) => {
            const isActive = currentTheme === theme.id;
            return (
              <button
                key={theme.id}
                type="button"
                className={"theme-card" + (isActive ? " theme-card--active" : "")}
                onClick={() =>
                  void save({ themeId: theme.id === "default-dark" ? "" : theme.id })
                }
                title={theme.label}
              >
                <div className="theme-card__preview">
                  <div
                    className="theme-card__preview-bg"
                    style={{ background: theme.preview.bg }}
                  />
                  <div
                    className="theme-card__preview-sidebar"
                    style={{ background: theme.preview.sidebar }}
                  />
                  <div className="theme-card__preview-main">
                    <div
                      className="theme-card__preview-accent"
                      style={{ background: theme.preview.accent }}
                    />
                    <div
                      className="theme-card__preview-text"
                      style={{ background: theme.preview.text, width: "80%" }}
                    />
                    <div
                      className="theme-card__preview-text"
                      style={{ background: theme.preview.text, width: "60%" }}
                    />
                  </div>
                  {isActive && (
                    <div className="theme-card__check">
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                        <polyline points="2,6 5,9 10,3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  )}
                </div>
                <span className="theme-card__label">{theme.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* --- B. Accent Color --- */}
      <section className="settings-section">
        <h3 className="settings-section__label">Accent colour</h3>
        <div className="accent-row">
          {ACCENT_PRESETS.map((preset) => {
            const isActive =
              settings.accentColor === preset.hex ||
              (!settings.accentColor && preset.id === "blue");
            return (
              <button
                key={preset.id}
                type="button"
                className={"accent-swatch-circle" + (isActive ? " accent-swatch-circle--active" : "")}
                style={{ background: preset.hex }}
                title={preset.label}
                onClick={() =>
                  void save({ accentColor: preset.id === "blue" ? "" : preset.hex })
                }
              />
            );
          })}

          {/* Custom hex input */}
          <div className="accent-custom">
            <div
              className="accent-custom__preview"
              style={{
                background: /^#[0-9a-f]{3,8}$/i.test(accentHexInput)
                  ? accentHexInput
                  : "transparent",
              }}
            />
            <input
              type="text"
              className="accent-custom__input"
              value={accentHexInput}
              placeholder="#rrggbb"
              spellCheck={false}
              maxLength={9}
              onChange={(e) => setAccentHexInput(e.target.value)}
              onBlur={() => {
                const val = accentHexInput.trim();
                if (val === "" || /^#[0-9a-f]{3,8}$/i.test(val)) {
                  void save({ accentColor: val });
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          </div>
        </div>
      </section>

      {/* --- C. Poster Roundness --- */}
      <section className="settings-section">
        <h3 className="settings-section__label">Poster roundness</h3>
        <div className="poster-radius-options">
          {POSTER_RADIUS_OPTIONS.map((opt) => {
            const isActive = currentRadius === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                className={"poster-radius-card" + (isActive ? " poster-radius-card--active" : "")}
                onClick={() => void save({ posterRadius: opt.id })}
                title={opt.label}
              >
                <div
                  className="poster-radius-card__preview"
                  style={{ borderRadius: opt.radius }}
                />
                <span className="poster-radius-card__label">{opt.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* --- D. Background Style --- */}
      <section className="settings-section">
        <h3 className="settings-section__label">Background</h3>
        <div className="bg-style-options">
          {BG_STYLE_OPTIONS.map((opt) => {
            const isActive = currentBgStyle === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                className={"bg-style-card" + (isActive ? " bg-style-card--active" : "")}
                onClick={() => void save({ backgroundStyle: opt.id })}
                title={opt.label}
              >
                <div
                  className="bg-style-card__preview"
                  style={{ background: opt.preview }}
                />
                <span className="bg-style-card__label">{opt.label}</span>
              </button>
            );
          })}
        </div>

        {currentBgStyle === "custom-solid" && (
          <div className="bg-custom-color-row">
            <div
              className="bg-custom-color-preview"
              style={{
                background: /^#[0-9a-f]{3,8}$/i.test(bgColorInput)
                  ? bgColorInput
                  : "transparent",
              }}
            />
            <input
              type="text"
              className="bg-custom-color-input accent-custom__input"
              value={bgColorInput}
              placeholder="#rrggbb"
              spellCheck={false}
              maxLength={9}
              onChange={(e) => setBgColorInput(e.target.value)}
              onBlur={() => {
                const val = bgColorInput.trim();
                if (val === "" || /^#[0-9a-f]{3,8}$/i.test(val)) {
                  void save({ customBackgroundColor: val });
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
            <span className="muted small">Solid background color</span>
          </div>
        )}
      </section>

      {/* --- E. Custom CSS --- */}
      <section className="settings-section">
        <h3 className="settings-section__label">
          Custom CSS{" "}
          <span style={{ opacity: 0.55, fontWeight: 400, fontSize: "11px" }}>
            (optional)
          </span>
        </h3>
        <div className="warning-banner warning-banner--small" style={{ marginBottom: 8 }}>
          Local only -- do not paste remote @import rules. Reset if the UI breaks.
        </div>
        <textarea
          className="custom-css-textarea"
          value={customCssInput}
          placeholder=":root { --color-accent: #ff9f6b; }"
          spellCheck={false}
          onChange={(e) => {
            const val = e.target.value;
            setCustomCssInput(val);
            if (customCssSaveTimer.current) clearTimeout(customCssSaveTimer.current);
            customCssSaveTimer.current = setTimeout(() => {
              void save({ customCss: val });
            }, 600);
          }}
        />
        <div className="appearance-css-actions">
          <button
            type="button"
            className="primary-button"
            style={{ fontSize: 12, padding: "5px 14px" }}
            onClick={() => void save({ customCss: customCssInput })}
          >
            Apply CSS
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              setCustomCssInput("");
              void save({ customCss: "" });
            }}
          >
            Clear CSS
          </button>
        </div>
      </section>

      {/* Reset all appearance */}
      <section className="settings-section" style={{ borderTop: "1px solid var(--color-border, var(--border))", paddingTop: 16 }}>
        <h3 className="settings-section__label">Reset</h3>
        <div className="appearance-reset-row">
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              void save({
                themeId: "",
                accentColor: "",
                customCss: "",
                posterRadius: "soft",
                backgroundStyle: "",
                customBackgroundColor: "",
                customBackgroundGradient: "",
              });
              setCustomCssInput("");
              setAccentHexInput("");
              setBgColorInput("");
            }}
          >
            Reset all appearance
          </button>
        </div>
      </section>
    </div>
  );
}
