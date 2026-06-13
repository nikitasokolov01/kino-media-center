// Settings > Player > Audio — preferred audio language + anime override.

import { useEffect, useState } from "react";
import { useSettings } from "../../../state/SettingsContext.js";

const ANIME_AUDIO_PRESETS: { value: string; label: string }[] = [
  { value: "",    label: "Use global default" },
  { value: "ja",  label: "Japanese" },
  { value: "en",  label: "English" },
  { value: "auto", label: "Original / Auto" },
];

export default function AudioSettings() {
  const { settings, update } = useSettings();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [audioLangInput, setAudioLangInput] = useState(settings.audioLanguage);
  const [animeAudioInput, setAnimeAudioInput] = useState(settings.animeAudioLanguage);

  useEffect(() => {
    setAudioLangInput(settings.audioLanguage);
  }, [settings.audioLanguage]);

  useEffect(() => {
    setAnimeAudioInput(settings.animeAudioLanguage);
  }, [settings.animeAudioLanguage]);

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
      <h2 className="settings-panel__title">Audio</h2>
      <p className="muted small">
        After MPV starts, the app tries to switch to your preferred audio
        language if a matching track exists.
      </p>

      {saveError && (
        <div className="error-banner">Could not save: {saveError}</div>
      )}

      <section className="settings-section">
        <h3 className="settings-section__label">Preferred audio language</h3>
        <div className="form-row">
          <label className="field-label">
            Language code or name
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
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              placeholder="Original / Auto (e.g. ja, jpn, Japanese)"
              spellCheck={false}
              autoComplete="off"
              className="text-input"
            />
          </label>
        </div>
        <p className="muted small">
          Leave blank to keep MPV's original/default audio.
        </p>
      </section>

      <section className="settings-section">
        <h3 className="settings-section__label">Anime default audio language</h3>
        <div className="form-row">
          <label className="field-label">
            Override for anime content
            <input
              type="text"
              value={animeAudioInput}
              onChange={(e) => setAnimeAudioInput(e.target.value)}
              onBlur={() => {
                const next = animeAudioInput.trim();
                if (next !== settings.animeAudioLanguage) {
                  void saveSetting({ animeAudioLanguage: next });
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              placeholder="Use global default (blank), or ja / jpn / Japanese"
              spellCheck={false}
              autoComplete="off"
              className="text-input"
            />
          </label>
        </div>
        <div className="preset-row">
          {ANIME_AUDIO_PRESETS.map((p) => (
            <button
              key={p.value || "global"}
              type="button"
              className={`chip${
                (settings.animeAudioLanguage || "") === p.value
                  ? " chip--active"
                  : ""
              }`}
              onClick={() => {
                setAnimeAudioInput(p.value);
                void saveSetting({ animeAudioLanguage: p.value });
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="muted small">
          Anime is detected from Kitsu/provider signals first, then an explicit
          "Anime" genre. Western animation (e.g. Arcane, The Simpsons) is not
          treated as anime. "Use global default" defers to the setting above;
          "Original / Auto" keeps MPV's default audio.
        </p>
      </section>
    </div>
  );
}
