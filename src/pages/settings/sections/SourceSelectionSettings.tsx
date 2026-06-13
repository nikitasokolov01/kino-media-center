// Settings > Player > Source Selection — auto-select, auto-play, quality, CAM filter.

import { useState } from "react";
import { useSettings } from "../../../state/SettingsContext.js";
import type { PreferredSourceQuality } from "../../../core/player/types.js";

const QUALITY_OPTIONS: { value: PreferredSourceQuality; label: string }[] = [
  { value: "best",  label: "Best available" },
  { value: "2160p", label: "4K / 2160p" },
  { value: "1080p", label: "1080p" },
  { value: "720p",  label: "720p" },
  { value: "first", label: "First available" },
];

export default function SourceSelectionSettings() {
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
      <h2 className="settings-panel__title">Source Selection</h2>
      <p className="muted small">
        Controls how the app ranks and selects stream sources from installed
        addons. Manual selection always remains available.
      </p>

      {saveError && (
        <div className="error-banner">Could not save: {saveError}</div>
      )}

      <section className="settings-section">
        <h3 className="settings-section__label">Auto-select best source</h3>
        <p className="muted small">
          When on, the app ranks the fetched sources and marks the best one with
          an "Auto-selected" badge, plus a "Play Best Source" button.
        </p>
        <div className="radio-row">
          {([
            {
              v: false,
              title: "Manual (off)",
              desc: "Pick a source yourself from the list.",
            },
            {
              v: true,
              title: "Auto-select best source",
              desc: "Rank sources and surface a Play Best Source button.",
            },
          ] as { v: boolean; title: string; desc: string }[]).map((opt) => (
            <label key={String(opt.v)} className="radio-card">
              <input
                type="radio"
                name="autoSelectSource"
                checked={settings.autoSelectSource === opt.v}
                onChange={() => void saveSetting({ autoSelectSource: opt.v })}
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
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.autoPlayBestSource}
            onChange={(e) =>
              void saveSetting({ autoPlayBestSource: e.target.checked })
            }
          />
          <span>
            Auto-play best source
            <span className="muted small">
              {" "}
              -- Automatically start playback using the best available direct
              source when opening a movie or selecting an episode.
            </span>
          </span>
        </label>
      </section>

      <section className="settings-section">
        <h3 className="settings-section__label">Preferred source quality</h3>
        <div className="form-row">
          <label className="field-label">
            Quality preference
            <select
              className="text-input"
              value={settings.preferredSourceQuality}
              onChange={(e) =>
                void saveSetting({
                  preferredSourceQuality: e.target
                    .value as PreferredSourceQuality,
                })
              }
            >
              {QUALITY_OPTIONS.map((q) => (
                <option key={q.value} value={q.value}>
                  {q.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted small">
          Only direct HTTP/HTTPS sources are considered (MPV requirement). If
          the preferred quality is unavailable, the next best is used. "First
          available" takes the first direct source in addon order.
        </p>
      </section>

      <section className="settings-section">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.hideCamSources}
            onChange={(e) =>
              void saveSetting({ hideCamSources: e.target.checked })
            }
          />
          <span>
            Hide / deprioritize CAM &amp; TS sources
            <span className="muted small">
              {" "}
              -- low-quality captures are only auto-selected if nothing else is
              playable.
            </span>
          </span>
        </label>
      </section>
    </div>
  );
}
