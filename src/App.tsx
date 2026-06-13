import { Navigate, Route, Routes } from "react-router-dom";
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
import NowPlayingBar from "./components/NowPlayingBar.js";
import TopNav from "./components/TopNav.js";
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
  const { profile } = useProfile();
  const { settings } = useSettings();
  const embeddedEnabled = settings.experimentalEmbeddedPlayer;

  // No active profile -> show the launch picker (Netflix-style).
  if (!profile) {
    return <ProfilePicker />;
  }

  return (
    <>
      <div className="app-shell">
        <TopNav />
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
