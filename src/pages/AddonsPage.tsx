import { useCallback, useEffect, useState } from "react";
import { useProfile } from "../state/ProfileContext.js";
import AddonCard from "../components/AddonCard.js";
import type { AddonRow } from "../types/preload.js";

export default function AddonsPage() {
  const { profile, loading: profileLoading } = useProfile();
  const [addons, setAddons] = useState<AddonRow[]>([]);
  const [url, setUrl] = useState("");
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!profile) return;
    try {
      const list = await window.mediaCenter.addons.list(profile.id);
      setAddons(list);
      setListError(null);
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e));
    }
  }, [profile]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleInstall(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    const trimmed = url.trim();
    if (!trimmed) return;

    setInstalling(true);
    setInstallError(null);
    try {
      await window.mediaCenter.addons.install(profile.id, trimmed);
      setUrl("");
      await refresh();
    } catch (e) {
      setInstallError(e instanceof Error ? e.message : String(e));
    } finally {
      setInstalling(false);
    }
  }

  async function handleRemove(id: string) {
    if (!profile) return;
    try {
      await window.mediaCenter.addons.remove(profile.id, id);
      await refresh();
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleInstallFake() {
    if (!profile) return;
    const fn = window.mediaCenter.addons.installFake;
    if (!fn) {
      setInstallError(
        "installFake is only available in development builds.",
      );
      return;
    }
    setInstallError(null);
    try {
      await fn(profile.id);
      await refresh();
    } catch (e) {
      setInstallError(e instanceof Error ? e.message : String(e));
    }
  }

  // Vite injects this; true only during `npm run dev`.
  const isDev = import.meta.env.DEV;

  return (
    <div className="page">
      <h1>Addons</h1>
      <p className="muted">
        Paste a Stremio addon base URL or a direct manifest.json URL.
      </p>

      <form className="install-form" onSubmit={handleInstall}>
        <input
          type="text"
          placeholder="https://example.com/manifest.json"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={installing || profileLoading || !profile}
          spellCheck={false}
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={installing || profileLoading || !profile || !url.trim()}
        >
          {installing ? "Installing…" : "Install"}
        </button>
      </form>

      {isDev && (
        <div className="dev-tools">
          <span className="dev-tools__label">Dev tools</span>
          <button
            type="button"
            className="ghost-button"
            onClick={handleInstallFake}
            disabled={!profile || installing}
            title="Inserts an addon pointing at an unreachable URL so you can test graceful failure on the Home page and Media Detail page."
          >
            Install fake/broken addon
          </button>
        </div>
      )}

      {installError && (
        <div className="error-banner">Install failed: {installError}</div>
      )}
      {listError && (
        <div className="error-banner">Could not load addons: {listError}</div>
      )}

      <section className="addon-grid">
        {addons.length === 0 && !profileLoading && (
          <div className="empty">No addons installed yet.</div>
        )}
        {addons.map((a) => (
          <AddonCard key={a.id} addon={a} onRemove={() => handleRemove(a.id)} />
        ))}
      </section>
    </div>
  );
}
