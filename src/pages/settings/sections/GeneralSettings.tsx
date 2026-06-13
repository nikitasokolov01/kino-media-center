// Settings > General — default player selection.

import { useState } from "react";
import { useSettings } from "../../../state/SettingsContext.js";
import { BACKENDS } from "../../../core/player/playerBackends.js";
import type { DefaultPlayerSetting } from "../../../core/player/types.js";

export default function GeneralSettings() {
  const { settings, update } = useSettings();
  const [saveError, setSaveError] = useState<string | null>(null);

  async function handleDefaultPlayerChange(v: DefaultPlayerSetting) {
    setSaveError(null);
    try {
      await update({ defaultPlayer: v });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="settings-panel">
      <h2 className="settings-panel__title">General</h2>

      {saveError && (
        <div className="error-banner">Could not save: {saveError}</div>
      )}

      <section className="settings-section">
        <h3 className="settings-section__label">Default player</h3>
        <p className="muted small">
          Used when a stream has a direct HTTP/HTTPS URL and both backends are
          viable. MPV plays nearly any container; the browser is faster to start
          but struggles with .mkv and many CDN streams.
        </p>
        <div className="radio-row">
          {(["mpv", "browser"] as DefaultPlayerSetting[]).map((v) => (
            <label key={v} className="radio-card">
              <input
                type="radio"
                name="defaultPlayer"
                value={v}
                checked={settings.defaultPlayer === v}
                onChange={() => handleDefaultPlayerChange(v)}
              />
              <div>
                <div className="radio-card__title">
                  {v === "mpv" ? "MPV (external)" : "Browser"}
                </div>
                <div className="radio-card__desc muted small">
                  {v === "mpv"
                    ? BACKENDS["mpv-external"].description
                    : BACKENDS.browser.description}
                </div>
              </div>
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}
