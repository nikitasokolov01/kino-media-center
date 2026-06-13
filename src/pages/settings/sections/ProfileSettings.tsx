// Settings > Profiles — lists profiles; full management via the sidebar switcher.

import { useEffect, useState } from "react";
import { useProfile } from "../../../state/ProfileContext.js";
import ProfileAvatar from "../../../components/ProfileAvatar.js";
import type { Profile } from "../../../types/preload.js";

export default function ProfileSettings() {
  const { profile: activeProfile, clearActiveProfile } = useProfile();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    window.mediaCenter.profile
      .list()
      .then((rows: Profile[]) => {
        if (!cancelled) {
          setProfiles(rows);
          setLoadError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="settings-panel">
      <h2 className="settings-panel__title">Profiles</h2>
      <p className="muted small">
        Each profile has its own addons, library, and watch history. To create,
        rename, or delete profiles, click your profile avatar in the sidebar.
      </p>

      {loadError && (
        <div className="error-banner">Could not load profiles: {loadError}</div>
      )}

      <section className="settings-section">
        <h3 className="settings-section__label">
          Installed profiles
          {loading ? " (loading...)" : ` (${profiles.length})`}
        </h3>

        <div className="profile-settings-list">
          {profiles.map((p) => {
            const isActive: boolean = activeProfile?.id === p.id;
            return (
              <div
                key={p.id}
                className={[
                  "profile-settings-row",
                  isActive ? "profile-settings-row--active" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <ProfileAvatar profile={p} size={36} />
                <div className="profile-settings-row__info">
                  <span className="profile-settings-row__name">{p.name}</span>
                  {isActive ? (
                    <span className="profile-settings-row__badge">Active</span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          className="ghost-button"
          style={{ marginTop: 16 }}
          onClick={clearActiveProfile}
        >
          Manage profiles
        </button>
        <p className="muted small" style={{ marginTop: 4 }}>
          Opens the profile picker where you can add, rename, or remove profiles.
        </p>
      </section>
    </div>
  );
}
