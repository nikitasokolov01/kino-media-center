// First-launch onboarding flow.
//
// Cinematic, multi-step intro shown when `hasCompletedOnboarding` is false.
// Purely additive: it reuses existing IPC (profile create/rename, addon install,
// settings update) and never wipes data. Existing installs are migrated to
// "completed" in db.ts so they never see this unless the user resets onboarding.
//
// Steps: Welcome -> Profile -> Addon -> Player -> Appearance -> Finish.

import { useEffect, useMemo, useState } from "react";
import { useProfile } from "../state/ProfileContext.js";
import { useSettings } from "../state/SettingsContext.js";
import KinoLogo from "./KinoLogo.js";

const STEP_COUNT = 6;

const THEME_CHOICES = [
  { id: "default-dark", label: "Default Dark", swatch: "#0f1115", accent: "#6aa3ff" },
  { id: "oled-black",   label: "OLED Black",   swatch: "#000000", accent: "#6aa3ff" },
  { id: "red",          label: "Cinema Red",   swatch: "#130b0b", accent: "#ff6b6b" },
] as const;

const LAYOUT_CHOICES = [
  { id: "portrait",  label: "Portrait" },
  { id: "landscape", label: "Landscape" },
  { id: "auto",      label: "Auto" },
] as const;

export default function Onboarding() {
  const { profiles, createProfile, updateProfile, selectProfile, refreshProfiles } = useProfile();
  const { settings, update } = useSettings();

  const [step, setStep] = useState(0);
  const [name, setName] = useState("You");
  const [profileId, setProfileId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // Addon step
  const [addonUrl, setAddonUrl] = useState("");
  const [addonStatus, setAddonStatus] = useState<null | "adding" | "ok" | "error">(null);
  const [addonError, setAddonError] = useState<string | null>(null);
  const [addedCount, setAddedCount] = useState(0);

  // Prefill the name from the existing first profile (unless it's the stock
  // "Default", in which case we suggest "You").
  useEffect(() => {
    const first = profiles[0];
    if (first && first.name && first.name !== "Default") setName(first.name);
  }, [profiles]);

  const embeddedAvailable = useMemo(
    () => typeof window !== "undefined" && !!window.embeddedMpv,
    [],
  );

  // Resolve (rename or create) the onboarding profile and remember its id.
  async function ensureProfile(): Promise<number> {
    const trimmed = name.trim() || "You";
    if (profileId !== null) {
      try { await updateProfile(profileId, { name: trimmed }); } catch { /* ignore */ }
      return profileId;
    }
    const first = profiles[0];
    if (first) {
      try { await updateProfile(first.id, { name: trimmed }); } catch { /* ignore */ }
      setProfileId(first.id);
      return first.id;
    }
    const created = await createProfile({ name: trimmed, color: "#6aa3ff", emoji: "🍿" });
    setProfileId(created.id);
    return created.id;
  }

  async function goFromProfile() {
    setBusy(true);
    try {
      await ensureProfile();
      setStep(2);
    } finally {
      setBusy(false);
    }
  }

  async function handleAddAddon() {
    const url = addonUrl.trim();
    if (!url) return;
    setAddonStatus("adding");
    setAddonError(null);
    try {
      const pid = profileId ?? (await ensureProfile());
      await window.mediaCenter.addons.install(pid, url);
      await refreshProfiles();
      setAddonStatus("ok");
      setAddedCount((n) => n + 1);
      setAddonUrl("");
    } catch (e) {
      setAddonStatus("error");
      setAddonError(e instanceof Error ? e.message : String(e));
    }
  }

  async function finish() {
    setBusy(true);
    try {
      const pid = profileId ?? (await ensureProfile());
      await update({ hasCompletedOnboarding: true });
      selectProfile(pid);
    } finally {
      setBusy(false);
    }
  }

  function pickTheme(themeId: string) {
    void update({ themeId });
  }
  function pickLayout(layout: "portrait" | "landscape" | "auto") {
    void update({ posterLayout: layout });
  }

  return (
    <div className="onboarding">
      <div className="onboarding__backdrop" aria-hidden="true" />
      <div className="onboarding__scrim" aria-hidden="true" />

      <div className="onboarding__card">
        {/* Progress dots */}
        <div className="onboarding__dots" aria-hidden="true">
          {Array.from({ length: STEP_COUNT }).map((_, i) => (
            <span
              key={i}
              className={"onboarding__dot" + (i === step ? " onboarding__dot--active" : i < step ? " onboarding__dot--done" : "")}
            />
          ))}
        </div>

        {/* Step 0: Welcome */}
        {step === 0 && (
          <div className="onboarding__step onboarding__step--welcome">
            <KinoLogo mode="wordmark" size={42} />
            <h1 className="onboarding__title">Welcome to Kino</h1>
            <p className="onboarding__lede">
              A cinematic desktop media center powered by your addons.
            </p>
            <button type="button" className="btn btn--primary btn--lg" onClick={() => setStep(1)}>
              Get Started
            </button>
          </div>
        )}

        {/* Step 1: Profile */}
        {step === 1 && (
          <div className="onboarding__step">
            <h2 className="onboarding__heading">Set up your profile</h2>
            <p className="onboarding__sub">Pick a name. You can add more profiles later.</p>
            <label className="onboarding__field">
              <span className="field-label">Profile name</span>
              <input
                className="input onboarding__input"
                type="text"
                value={name}
                maxLength={40}
                placeholder="You"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !busy) void goFromProfile(); }}
                autoFocus
              />
            </label>
            <div className="onboarding__actions">
              <button type="button" className="ghost-button" onClick={() => setStep(0)}>Back</button>
              <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void goFromProfile()}>
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Addon */}
        {step === 2 && (
          <div className="onboarding__step">
            <h2 className="onboarding__heading">Add an addon</h2>
            <p className="onboarding__sub">
              Kino streams from Stremio-compatible addons. Paste an addon&apos;s
              manifest URL to install it, or skip and add one later.
            </p>
            <label className="onboarding__field">
              <span className="field-label">Manifest URL</span>
              <input
                className="input onboarding__input"
                type="text"
                value={addonUrl}
                placeholder="https://.../manifest.json"
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => { setAddonUrl(e.target.value); setAddonStatus(null); }}
                onKeyDown={(e) => { if (e.key === "Enter" && addonStatus !== "adding") void handleAddAddon(); }}
              />
            </label>
            {addonStatus === "error" && addonError && (
              <div className="error-banner onboarding__banner">Could not add addon: {addonError}</div>
            )}
            {addedCount > 0 && (
              <div className="onboarding__success">
                {addedCount} addon{addedCount === 1 ? "" : "s"} installed. Add another or continue.
              </div>
            )}
            <div className="onboarding__actions">
              <button type="button" className="ghost-button" onClick={() => setStep(1)}>Back</button>
              <span className="onboarding__spacer" />
              <button
                type="button"
                className="btn btn--secondary"
                disabled={!addonUrl.trim() || addonStatus === "adding"}
                onClick={() => void handleAddAddon()}
              >
                {addonStatus === "adding" ? "Adding..." : "Add Addon"}
              </button>
              <button type="button" className="btn btn--primary" onClick={() => setStep(3)}>
                {addedCount > 0 ? "Continue" : "Skip for now"}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Player preference */}
        {step === 3 && (
          <div className="onboarding__step">
            <h2 className="onboarding__heading">Choose your player</h2>
            <p className="onboarding__sub">
              Kino&apos;s built-in player is recommended. External MPV remains
              available as a fallback for any source.
            </p>
            <div className="onboarding__radio-list">
              <label className={"onboarding__radio" + (settings.experimentalEmbeddedPlayer ? " onboarding__radio--active" : "")}>
                <input
                  type="radio"
                  name="ob-player"
                  checked={settings.experimentalEmbeddedPlayer}
                  onChange={() => void update({ experimentalEmbeddedPlayer: true })}
                />
                <span>
                  <strong>Built-in player</strong> <span className="badge badge--accent">Recommended</span>
                  <span className="onboarding__radio-desc">
                    Plays inside Kino with a cinematic overlay.{" "}
                    {embeddedAvailable ? "Built-in player is ready." : "Falls back to external MPV if unavailable."}
                  </span>
                </span>
              </label>
              <label className={"onboarding__radio" + (!settings.experimentalEmbeddedPlayer ? " onboarding__radio--active" : "")}>
                <input
                  type="radio"
                  name="ob-player"
                  checked={!settings.experimentalEmbeddedPlayer}
                  onChange={() => void update({ experimentalEmbeddedPlayer: false })}
                />
                <span>
                  <strong>External MPV</strong>
                  <span className="onboarding__radio-desc">
                    Opens streams in the external MPV player. Configure its path in Settings.
                  </span>
                </span>
              </label>
            </div>
            <div className="onboarding__actions">
              <button type="button" className="ghost-button" onClick={() => setStep(2)}>Back</button>
              <button type="button" className="btn btn--primary" onClick={() => setStep(4)}>Continue</button>
            </div>
          </div>
        )}

        {/* Step 4: Appearance */}
        {step === 4 && (
          <div className="onboarding__step">
            <h2 className="onboarding__heading">Make it yours</h2>
            <p className="onboarding__sub">Pick a theme and poster layout. You can change these any time in Settings.</p>

            <span className="field-label">Theme</span>
            <div className="onboarding__theme-row">
              {THEME_CHOICES.map((th) => (
                <button
                  key={th.id}
                  type="button"
                  className={"onboarding__theme" + (settings.themeId === th.id ? " onboarding__theme--active" : "")}
                  onClick={() => pickTheme(th.id)}
                  title={th.label}
                >
                  <span className="onboarding__theme-swatch" style={{ background: th.swatch }}>
                    <span className="onboarding__theme-accent" style={{ background: th.accent }} />
                  </span>
                  <span className="onboarding__theme-label">{th.label}</span>
                </button>
              ))}
            </div>

            <span className="field-label" style={{ marginTop: 14 }}>Poster layout</span>
            <div className="onboarding__layout-row">
              {LAYOUT_CHOICES.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className={"settings-seg__btn" + (settings.posterLayout === l.id ? " settings-seg__btn--active" : "")}
                  onClick={() => pickLayout(l.id)}
                >
                  {l.label}
                </button>
              ))}
            </div>

            <div className="onboarding__actions">
              <button type="button" className="ghost-button" onClick={() => setStep(3)}>Back</button>
              <button type="button" className="btn btn--primary" onClick={() => setStep(5)}>Continue</button>
            </div>
          </div>
        )}

        {/* Step 5: Finish */}
        {step === 5 && (
          <div className="onboarding__step onboarding__step--welcome">
            <KinoLogo mode="icon" size={48} />
            <h2 className="onboarding__title">You&apos;re all set</h2>
            <p className="onboarding__lede">
              {addedCount > 0
                ? "Your addons are ready. Time to find something to watch."
                : "Add an addon any time from the Addons page to start browsing."}
            </p>
            <button type="button" className="btn btn--primary btn--lg" disabled={busy} onClick={() => void finish()}>
              {busy ? "Starting..." : "Start Browsing"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
