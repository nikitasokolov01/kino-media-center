// Settings > Player > Embedded Player — experimental embedded libmpv toggle.

import { useState } from "react";
import { useSettings } from "../../../state/SettingsContext.js";

export default function EmbeddedPlayerSettings() {
  const { settings, update } = useSettings();
  const [saveError, setSaveError] = useState<string | null>(null);

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
      <h2 className="settings-panel__title">Embedded Player</h2>
      <p className="muted small">
        Work-in-progress features. These do not affect normal playback — the
        external MPV player remains the default.
      </p>

      {saveError && (
        <div className="error-banner">Could not save: {saveError}</div>
      )}

      <section className="settings-section">
        <label className="checkbox-row" style={{ marginTop: 12 }}>
          <input
            type="checkbox"
            checked={settings.experimentalEmbeddedPlayer}
            onChange={(e) =>
              void saveSetting({ experimentalEmbeddedPlayer: e.target.checked })
            }
          />
          <span>
            Embedded player (experimental)
            <span className="muted small">
              {" "}
              -- adds an <strong>Embedded (experimental)</strong> page that
              renders libmpv video into an in-app canvas. Copy-based and
              unoptimized; requires the native addon to be built. Does not
              replace external MPV.
            </span>
          </span>
        </label>

        <div className="warning-banner warning-banner--small" style={{ marginTop: 16 }}>
          External MPV is always the default and fallback. Enabling this flag only
          adds the embedded canvas path as an optional alternative.
        </div>
      </section>
    </div>
  );
}
