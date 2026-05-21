// /settings — global app settings.
//
// Fields:
//   - Default player (Browser vs MPV)
//   - MPV executable path (defaults to "mpv", looked up on PATH)
//   - Test MPV button that runs `mpv --version` via IPC and shows the result.

import { useEffect, useState } from "react";
import { useSettings } from "../state/SettingsContext.js";
import { checkMpvAvailable } from "../core/player/mpvExternal.js";
import { BACKENDS } from "../core/player/playerBackends.js";
import type {
  DefaultPlayerSetting,
  MpvAvailability,
} from "../core/player/types.js";

export default function SettingsPage() {
  const { settings, loading, error, update } = useSettings();

  // Local form state, synced from `settings` once loaded.
  const [mpvPathInput, setMpvPathInput] = useState(settings.mpvPath);
  useEffect(() => {
    setMpvPathInput(settings.mpvPath);
  }, [settings.mpvPath]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<MpvAvailability | null>(null);
  const [testing, setTesting] = useState(false);

  // Local inputs for the language fields (debounced save on blur / Enter).
  const [subLangInput, setSubLangInput] = useState(settings.subtitleLanguage);
  const [audioLangInput, setAudioLangInput] = useState(settings.audioLanguage);
  useEffect(() => {
    setSubLangInput(settings.subtitleLanguage);
  }, [settings.subtitleLanguage]);
  useEffect(() => {
    setAudioLangInput(settings.audioLanguage);
  }, [settings.audioLanguage]);

  async function saveSetting(patch: Parameters<typeof update>[0]) {
    setSaveError(null);
    try {
      await update(patch);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDefaultPlayerChange(v: DefaultPlayerSetting) {
    setSaveError(null);
    try {
      await update({ defaultPlayer: v });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }

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
    // If the user typed a new path but didn't save, save it first so the
    // probe runs against what they actually want to verify.
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
    <div className="page">
      <h1>Settings</h1>

      {loading && <p className="muted">Loading settings…</p>}
      {error && <div className="error-banner">Could not load settings: {error}</div>}
      {saveError && <div className="error-banner">Could not save: {saveError}</div>}

      <section className="settings-section">
        <h2>Default player</h2>
        <p className="muted small">
          Used when a stream has a direct HTTP/HTTPS URL and both backends are
          viable. MPV plays nearly any container; the browser is faster to
          start but struggles with .mkv and many CDN streams.
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
                  {v === "mpv" ? BACKENDS["mpv-external"].description : BACKENDS.browser.description}
                </div>
              </div>
            </label>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h2>MPV path</h2>
        <p className="muted small">
          Path to the MPV executable. Defaults to <code>mpv</code> (looked up
          on PATH). On Windows you'll typically enter
          <code> C:\Program Files\mpv\mpv.exe</code>.
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
            {saving ? "Saving…" : "Save path"}
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={handleTestMpv}
            disabled={testing}
          >
            {testing ? "Testing…" : "Test MPV"}
          </button>
        </div>

        {testResult && (
          testResult.available ? (
            <div className="success-banner">
              MPV is available at <code>{testResult.path}</code>
              {testResult.version && <> · version <strong>{testResult.version}</strong></>}.
            </div>
          ) : (
            <div className="error-banner">
              MPV was not found at <code>{testResult.path}</code>.
              {testResult.error && <div className="muted small" style={{ marginTop: 4 }}>{testResult.error}</div>}
              <p className="small" style={{ marginTop: 6 }}>
                Install MPV from <a
                  href="https://mpv.io/installation/"
                  onClick={(e) => {
                    e.preventDefault();
                    void window.mediaCenter.system.openExternal("https://mpv.io/installation/");
                  }}
                  rel="noreferrer"
                >mpv.io/installation</a>, or enter its full path above and press Save.
              </p>
            </div>
          )
        )}
      </section>

      <section className="settings-section">
        <h2>Subtitles &amp; audio</h2>
        <p className="muted small">
          All available subtitle tracks are always auto-loaded into MPV when you
          press Play — you pick which one to show from the player controls after
          playback starts. These settings control what's selected by default.
        </p>

        <div className="radio-row">
          {([
            { v: false, title: "Subtitles off by default", desc: "Tracks are loaded but start hidden. Turn them on from the player's Subs menu." },
            { v: true, title: "Auto-enable subtitles", desc: "After MPV starts, try to turn on subtitles in your preferred language (below)." },
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

        <div className="form-row" style={{ marginTop: 12 }}>
          <label className="field-label">
            Preferred subtitle language
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

        <div className="form-row" style={{ marginTop: 12 }}>
          <label className="field-label">
            Preferred audio language
            <input
              type="text"
              value={audioLangInput}
              onChange={(e) => setAudioLangInput(e.target.value)}
              onBlur={() => {
                const next = audioLangInput.trim();
                if (next !== settings.audioLanguage) {
                  void saveSetting({ audioLanguage: next });
                }
              }}
              placeholder="Original / Auto (e.g. ja, jpn, Japanese)"
              spellCheck={false}
              autoComplete="off"
              className="text-input"
            />
          </label>
        </div>
        <p className="muted small">
          After MPV starts, the app tries to switch to this audio language if a
          matching track exists. Leave blank to keep the original/default audio.
        </p>
      </section>
    </div>
  );
}
