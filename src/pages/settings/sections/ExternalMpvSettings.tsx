// Settings > Player > External MPV — path configuration and test.

import { useEffect, useState } from "react";
import { useSettings } from "../../../state/SettingsContext.js";
import { checkMpvAvailable } from "../../../core/player/mpvExternal.js";
import type { MpvAvailability } from "../../../core/player/types.js";

export default function ExternalMpvSettings() {
  const { settings, update } = useSettings();
  const [mpvPathInput, setMpvPathInput] = useState(settings.mpvPath);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<MpvAvailability | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setMpvPathInput(settings.mpvPath);
  }, [settings.mpvPath]);

  async function handleSaveMpvPath() {
    setSaving(true);
    setSaveError(null);
    try {
      const next = mpvPathInput.trim() || "mpv";
      await update({ mpvPath: next });
      setMpvPathInput(next);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleTestMpv() {
    setTesting(true);
    setTestResult(null);
    const desired = mpvPathInput.trim() || "mpv";
    try {
      if (desired !== settings.mpvPath) {
        await update({ mpvPath: desired });
      }
      const res = await checkMpvAvailable();
      setTestResult(res);
    } catch (e) {
      setTestResult({
        available: false,
        path: desired,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="settings-panel">
      <h2 className="settings-panel__title">External MPV</h2>
      <p className="muted small">
        MPV is the primary player for direct HTTP/HTTPS streams. It handles
        MKV, AV1, and most CDN formats that the browser player cannot.
      </p>

      {saveError && (
        <div className="error-banner">Could not save: {saveError}</div>
      )}

      <section className="settings-section">
        <h3 className="settings-section__label">MPV executable path</h3>
        <p className="muted small">
          Defaults to <code>mpv</code> (looked up on PATH). On Windows you will
          typically enter <code>C:\Program Files\mpv\mpv.exe</code>.
        </p>
        <div className="form-row">
          <input
            type="text"
            value={mpvPathInput}
            onChange={(e) => setMpvPathInput(e.target.value)}
            placeholder="mpv"
            spellCheck={false}
            autoComplete="off"
            className="text-input"
          />
          <button
            type="button"
            className="primary-button"
            onClick={handleSaveMpvPath}
            disabled={saving || mpvPathInput.trim() === settings.mpvPath}
          >
            {saving ? "Saving..." : "Save path"}
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={handleTestMpv}
            disabled={testing}
          >
            {testing ? "Testing..." : "Test MPV"}
          </button>
        </div>

        {testResult != null && testResult.available && (
          <div className="success-banner">
            MPV is available at <code>{testResult.path}</code>
            {testResult.version != null && (
              <> &middot; version <strong>{testResult.version}</strong></>
            )}.
          </div>
        )}
        {testResult != null && !testResult.available && (
          <div className="error-banner">
            MPV was not found at <code>{testResult.path}</code>.
            {testResult.error != null && (
              <div className="muted small" style={{ marginTop: 4 }}>
                {testResult.error}
              </div>
            )}
            <p className="small" style={{ marginTop: 6 }}>
              Install MPV from{" "}
              <a
                href="https://mpv.io/installation/"
                onClick={(e) => {
                  e.preventDefault();
                  void window.mediaCenter.system.openExternal(
                    "https://mpv.io/installation/",
                  );
                }}
                rel="noreferrer"
              >
                mpv.io/installation
              </a>
              , or enter its full path above and press Save.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
