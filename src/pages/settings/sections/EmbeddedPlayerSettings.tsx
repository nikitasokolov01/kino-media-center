// Settings > Player > Built-in Player — embedded libmpv canvas player toggle.

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
      <h2 className="settings-panel__title">Built-in Player</h2>
      <p className="muted small">
        Enable the built-in libmpv player, which renders video directly inside
        the app window. External MPV is always available as a fallback.
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
            Enable built-in player
            <span className="muted small">
              {" "}
              -- renders libmpv video in an in-app canvas overlay.
              Requires the native addon to be present. External MPV remains
              available as a fallback via stream cards.
            </span>
          </span>
        </label>

        {!settings.experimentalEmbeddedPlayer && (
          <div className="warning-banner warning-banner--small" style={{ marginTop: 16 }}>
            Built-in player is disabled. All playback will use External MPV.
          </div>
        )}
      </section>
    </div>
  );
}
