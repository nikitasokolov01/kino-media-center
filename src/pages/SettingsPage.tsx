// /settings — Settings hub with left-nav sidebar + content panel.
//
// Navigation is URL-driven via ?tab=<tab>&sub=<sub> search params so deep
// links work (e.g. /settings?tab=player&sub=mpv).  No new routes are added to
// App.tsx — this component owns the internal routing entirely.
//
// Tab/sub mapping:
//   ?tab=general                — Default player
//   ?tab=addons                 — Addon manager
//   ?tab=player&sub=embedded    — Built-in player (libmpv canvas) toggle
//   ?tab=player&sub=mpv         — External MPV path + test
//   ?tab=player&sub=sources     — Source selection / quality / CAM filter
//   ?tab=player&sub=subtitles   — Auto-enable subtitles + language
//   ?tab=player&sub=audio       — Audio language + anime override
//   ?tab=appearance             — Theme / accent / custom CSS
//   ?tab=profiles               — Profile list + switcher link
//   ?tab=about                  — App info

import { useSearchParams } from "react-router-dom";
import { useSettings } from "../state/SettingsContext.js";
import GeneralSettings from "./settings/sections/GeneralSettings.js";
import AddonsSettings from "./settings/sections/AddonsSettings.js";
import EmbeddedPlayerSettings from "./settings/sections/EmbeddedPlayerSettings.js";
import ExternalMpvSettings from "./settings/sections/ExternalMpvSettings.js";
import SourceSelectionSettings from "./settings/sections/SourceSelectionSettings.js";
import SubtitleSettings from "./settings/sections/SubtitleSettings.js";
import AudioSettings from "./settings/sections/AudioSettings.js";
import AppearanceSettings from "./settings/sections/AppearanceSettings.js";
import ProfileSettings from "./settings/sections/ProfileSettings.js";
import AboutSettings from "./settings/sections/AboutSettings.js";

type Tab = "general" | "addons" | "player" | "appearance" | "profiles" | "about";
type PlayerSub = "embedded" | "mpv" | "sources" | "subtitles" | "audio";

const PLAYER_SUBS: { id: PlayerSub; label: string }[] = [
  { id: "embedded",  label: "Built-in Player" },
  { id: "mpv",       label: "External MPV" },
  { id: "sources",   label: "Source Selection" },
  { id: "subtitles", label: "Subtitles" },
  { id: "audio",     label: "Audio" },
];

export default function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { loading, error } = useSettings();

  const rawTab = searchParams.get("tab") ?? "general";
  const tab = (rawTab as Tab);
  const rawSub = searchParams.get("sub") ?? "embedded";
  const sub = (rawSub as PlayerSub);

  function nav(newTab: Tab, newSub?: string) {
    if (newSub != null) {
      setSearchParams({ tab: newTab, sub: newSub });
    } else {
      setSearchParams({ tab: newTab });
    }
  }

  function renderContent() {
    switch (tab) {
      case "general":    return <GeneralSettings />;
      case "addons":     return <AddonsSettings />;
      case "player":
        switch (sub) {
          case "mpv":       return <ExternalMpvSettings />;
          case "sources":   return <SourceSelectionSettings />;
          case "subtitles": return <SubtitleSettings />;
          case "audio":     return <AudioSettings />;
          default:          return <EmbeddedPlayerSettings />;
        }
      case "appearance": return <AppearanceSettings />;
      case "profiles":   return <ProfileSettings />;
      case "about":      return <AboutSettings />;
      default:           return <GeneralSettings />;
    }
  }

  return (
    <div className="page settings-hub-page">
      {loading && <p className="muted">Loading settings...</p>}
      {error && (
        <div className="error-banner">Could not load settings: {error}</div>
      )}

      <div className="settings-hub">
        {/* Left sidebar nav */}
        <nav className="settings-hub__nav">
          <NavItem
            active={tab === "general"}
            onClick={() => nav("general")}
            label="General"
          />
          <NavItem
            active={tab === "addons"}
            onClick={() => nav("addons")}
            label="Addons"
          />

          {/* Player top-level item */}
          <NavItem
            active={tab === "player"}
            onClick={() => nav("player", sub === "embedded" ? "embedded" : sub)}
            label="Player"
          />
          {/* Player sub-items — always visible */}
          {PLAYER_SUBS.map((s) => (
            <NavItem
              key={s.id}
              active={tab === "player" && sub === s.id}
              onClick={() => nav("player", s.id)}
              label={s.label}
              isSub
            />
          ))}

          <NavItem
            active={tab === "appearance"}
            onClick={() => nav("appearance")}
            label="Appearance"
          />
          <NavItem
            active={tab === "profiles"}
            onClick={() => nav("profiles")}
            label="Profiles"
          />
          <NavItem
            active={tab === "about"}
            onClick={() => nav("about")}
            label="About"
          />
        </nav>

        {/* Right content panel */}
        <div className="settings-hub__panel">{renderContent()}</div>
      </div>
    </div>
  );
}

interface NavItemProps {
  active: boolean;
  onClick: () => void;
  label: string;
  isSub?: boolean;
}

function NavItem({ active, onClick, label, isSub = false }: NavItemProps) {
  return (
    <button
      type="button"
      className={[
        "settings-nav-item",
        active ? "settings-nav-item--active" : "",
        isSub ? "settings-nav-item--sub" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
