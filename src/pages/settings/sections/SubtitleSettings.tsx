// Settings > Player > Subtitles — auto-enable and preferred language.

import { useEffect, useState } from "react";
import { useSettings } from "../../../state/SettingsContext.js";

export default function SubtitleSettings() {
  const { settings, update } = useSettings();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [subLangInput, setSubLangInput] = useState(settings.subtitleLanguage);

  useEffect(() => {
    setSubLangInput(settings.subtitleLanguage);
  }, [settings.subtitleLanguage]);

  async function saveSetting(patch: Parameters<typeof update>[0]) {
    setSaveError(null);
    try {
      await update(patch);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="settings-panel">
      <h2 className="settings-panel__title">Subtitles</h2>
      <p className="muted small">
        All available subtitle tracks are always auto-loaded into MPV when you
        press Play -- you pick which one to show from the player controls after
        playback starts. These settings control what is selected by default.
      </p>

      {saveError && (
        <div className="error-banner">Could not save: {saveError}</div>
      )}

      <section className="settings-section">
        <h3 className="settings-section__label">Auto-enable subtitles</h3>
        <div className="radio-row">
          {([
            {
              v: false,
              title: "Subtitles off by default",
              desc: "Tracks are loaded but start hidden. Turn them on from the player's Subs menu.",
            },
            {
              v: true,
              title: "Auto-enable subtitles",
              desc: "After MPV starts, try to turn on subtitles in your preferred language (below).",
            },
          ] as { v: boolean; title: string; desc: string }[]).map((opt) => (
            <label key={String(opt.v)} className="radio-card">
              <input
                type="radio"
                name="autoEnableSubtitles"
                checked={settings.autoEnableSubtitles === opt.v}
                onChange={() => void saveSetting({ autoEnableSubtitles: opt.v })}
              />
              <div>
                <div className="radio-card__title">{opt.title}</div>
                <div className="radio-card__desc muted small">{opt.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h3 className="settings-section__label">Preferred subtitle language</h3>
        <div className="form-row">
          <label className="field-label">
            Language code or name
            <input
              type="text"
              value={subLangInput}
              onChange={(e) => setSubLangInput(e.target.value)}
              onBlur={() => {
                const next = subLangInput.trim();
                if (next !== settings.subtitleLanguage) {
                  void saveSetting({ subtitleLanguage: next });
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              placeholder="en / eng / English"
              spellCheck={false}
              autoComplete="off"
              className="text-input"
            />
          </label>
        </div>
        <p className="muted small">
          Used only when auto-enable is on. Accepts <code>en</code>,{" "}
          <code>eng</code>, or <code>English</code>. Leave blank for no
          preference.
        </p>
      </section>
    </div>
  );
}
