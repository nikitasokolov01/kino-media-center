// Launch screen: "Who's watching?" — pick a profile, or create / edit / delete
// profiles. Shown by App whenever there is no active profile.

import { useState } from "react";
import { useProfile } from "../state/ProfileContext.js";
import ProfileAvatar, { AVATAR_COLORS } from "../components/ProfileAvatar.js";
import type { Profile } from "../types/preload.js";

type Mode =
  | { kind: "grid" }
  | { kind: "create" }
  | { kind: "edit"; profile: Profile };

const EMOJI_CHOICES = ["🍿", "🎬", "📺", "🎮", "🦊", "🐱", "🚀", "🌙", "🔥", "🎧", "👾", "⭐"];

export default function ProfilePicker() {
  const {
    profiles,
    loading,
    error,
    selectProfile,
    createProfile,
    updateProfile,
    deleteProfile,
  } = useProfile();

  const [mode, setMode] = useState<Mode>({ kind: "grid" });

  if (loading) {
    return (
      <div className="profile-picker">
        <p className="muted">Loading profiles…</p>
      </div>
    );
  }

  if (mode.kind === "create" || mode.kind === "edit") {
    return (
      <ProfileForm
        initial={mode.kind === "edit" ? mode.profile : null}
        onCancel={() => setMode({ kind: "grid" })}
        onSubmit={async (data) => {
          if (mode.kind === "edit") {
            await updateProfile(mode.profile.id, data);
          } else {
            await createProfile(data);
          }
          setMode({ kind: "grid" });
        }}
        onDelete={
          mode.kind === "edit" && profiles.length > 1
            ? async () => {
                const res = await deleteProfile(mode.profile.id);
                if (res.ok) setMode({ kind: "grid" });
                return res;
              }
            : undefined
        }
      />
    );
  }

  return (
    <div className="profile-picker">
      <h1 className="profile-picker__title">Who's watching?</h1>
      {error && <div className="error-banner">{error}</div>}
      <div className="profile-picker__grid">
        {profiles.map((p) => (
          <div key={p.id} className="profile-tile">
            <button
              type="button"
              className="profile-tile__select"
              onClick={() => selectProfile(p.id)}
            >
              <ProfileAvatar profile={p} size={96} />
              <span className="profile-tile__name">{p.name}</span>
            </button>
            <button
              type="button"
              className="profile-tile__edit"
              onClick={() => setMode({ kind: "edit", profile: p })}
              title={`Edit ${p.name}`}
            >
              Edit
            </button>
          </div>
        ))}

        <div className="profile-tile">
          <button
            type="button"
            className="profile-tile__select profile-tile__add"
            onClick={() => setMode({ kind: "create" })}
          >
            <span className="profile-tile__add-circle" aria-hidden>
              +
            </span>
            <span className="profile-tile__name">Add profile</span>
          </button>
        </div>
      </div>
    </div>
  );
}

interface FormData {
  name: string;
  color: string;
  emoji: string | null;
}

function ProfileForm({
  initial,
  onSubmit,
  onCancel,
  onDelete,
}: {
  initial: Profile | null;
  onSubmit: (data: FormData) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<{ ok: boolean; error?: string }>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState(initial?.color ?? AVATAR_COLORS[0]);
  const [emoji, setEmoji] = useState<string | null>(initial?.emoji ?? "🍿");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const preview: Profile = {
    id: initial?.id ?? -1,
    name: name || "New profile",
    color,
    emoji,
    createdAt: "",
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setFormError("Please enter a profile name.");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await onSubmit({ name: name.trim(), color, emoji });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!onDelete) return;
    setBusy(true);
    setFormError(null);
    try {
      const res = await onDelete();
      if (!res.ok) setFormError(res.error ?? "Could not delete profile.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="profile-picker">
      <h1 className="profile-picker__title">
        {initial ? "Edit profile" : "Create profile"}
      </h1>

      <form className="profile-form" onSubmit={handleSubmit}>
        <div className="profile-form__preview">
          <ProfileAvatar profile={preview} size={96} />
        </div>

        <label className="profile-form__label">
          Name
          <input
            type="text"
            className="text-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Living Room"
            maxLength={40}
            autoFocus
          />
        </label>

        <div className="profile-form__label">
          Color
          <div className="swatch-row">
            {AVATAR_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`swatch ${c === color ? "swatch--active" : ""}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
                aria-label={`Color ${c}`}
              />
            ))}
          </div>
        </div>

        <div className="profile-form__label">
          Emoji
          <div className="emoji-row">
            <button
              type="button"
              className={`emoji-choice ${emoji === null ? "emoji-choice--active" : ""}`}
              onClick={() => setEmoji(null)}
              title="Use initial instead"
            >
              Aa
            </button>
            {EMOJI_CHOICES.map((em) => (
              <button
                key={em}
                type="button"
                className={`emoji-choice ${em === emoji ? "emoji-choice--active" : ""}`}
                onClick={() => setEmoji(em)}
              >
                {em}
              </button>
            ))}
          </div>
        </div>

        {formError && <div className="error-banner">{formError}</div>}

        <div className="profile-form__actions">
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? "Saving…" : initial ? "Save changes" : "Create profile"}
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <span style={{ flex: 1 }} />
          {onDelete &&
            (confirmDelete ? (
              <>
                <span className="muted small">Delete this profile?</span>
                <button
                  type="button"
                  className="danger-button"
                  onClick={handleDelete}
                  disabled={busy}
                >
                  Yes, delete
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setConfirmDelete(false)}
                  disabled={busy}
                >
                  No
                </button>
              </>
            ) : (
              <button
                type="button"
                className="danger-button"
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
              >
                Delete profile
              </button>
            ))}
        </div>
      </form>
    </div>
  );
}
