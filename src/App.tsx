import { Link, NavLink, Navigate, Route, Routes } from "react-router-dom";
import AddonsPage from "./pages/AddonsPage.js";
import HomePage from "./pages/HomePage.js";
import MediaPage from "./pages/MediaPage.js";
import ExpandedCatalogPage from "./pages/ExpandedCatalogPage.js";
import SearchPage from "./pages/SearchPage.js";
import PlayerPage from "./pages/PlayerPage.js";
import SettingsPage from "./pages/SettingsPage.js";
import LibraryPage from "./pages/LibraryPage.js";
import ProfilePicker from "./pages/ProfilePicker.js";
import ExperimentalEmbeddedPlayerPage from "./pages/ExperimentalEmbeddedPlayerPage.js";
import EmbeddedPlayerOverlay from "./components/EmbeddedPlayerOverlay.js";
import ProfileAvatar from "./components/ProfileAvatar.js";
import NowPlayingBar from "./components/NowPlayingBar.js";
import { ProfileProvider, useProfile } from "./state/ProfileContext.js";
import { SettingsProvider, useSettings } from "./state/SettingsContext.js";
import { LibraryProvider } from "./state/LibraryContext.js";
import { ToastProvider } from "./state/ToastContext.js";
import { ContextMenuProvider } from "./state/ContextMenuContext.js";
import ThemeProvider from "./theme/ThemeProvider.js";

export default function App() {
  return (
    <ProfileProvider>
      <SettingsProvider>
        <ThemeProvider>
          <LibraryProvider>
            <ToastProvider>
              <ContextMenuProvider>
                <AppInner />
              </ContextMenuProvider>
            </ToastProvider>
          </LibraryProvider>
        </ThemeProvider>
      </SettingsProvider>
    </ProfileProvider>
  );
}

function AppInner() {
  const { profile, clearActiveProfile } = useProfile();
  const { settings } = useSettings();
  const embeddedEnabled = settings.experimentalEmbeddedPlayer;

  // No active profile → show the launch picker (Netflix-style).
  if (!profile) {
    return <ProfilePicker />;
  }

  return (
    <>
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">Media Center</div>
        <nav>
          <NavLink to="/" end className="nav-item">
            Home
          </NavLink>
          <NavLink to="/library" className="nav-item">
            Library
          </NavLink>
        </nav>

        <div className="sidebar__spacer" />

        <div className="sidebar__bottom">
          <Link to="/settings" className="sidebar__gear-btn" title="Settings">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </Link>
          <button
            type="button"
            className="profile-switcher"
            onClick={clearActiveProfile}
            title="Switch profile"
          >
            <ProfileAvatar profile={profile} size={32} />
            <span className="profile-switcher__meta">
              <span className="profile-switcher__name">{profile.name}</span>
              <span className="profile-switcher__action">Switch profile</span>
            </span>
          </button>
        </div>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/addons" element={<AddonsPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route
            path="/catalog/:addonId/:type/:catalogId"
            element={<ExpandedCatalogPage />}
          />
          <Route path="/media/:type/:id" element={<MediaPage />} />
          <Route path="/watch/:type/:id" element={<PlayerPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          {embeddedEnabled && (
            <Route
              path="/experimental-embedded-player"
              element={<ExperimentalEmbeddedPlayerPage />}
            />
          )}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <NowPlayingBar />
    </div>
    {embeddedEnabled && <EmbeddedPlayerOverlay />}
    </>
  );
}
