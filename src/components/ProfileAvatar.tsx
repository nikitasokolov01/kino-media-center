// Small avatar bubble for a profile: a colored circle showing the emoji, or
// the profile's first initial when no emoji is set. Color falls back to a
// deterministic palette pick based on the profile id so legacy profiles
// (created before avatars existed) still look distinct.

import type { Profile } from "../types/preload.js";

export const AVATAR_COLORS = [
  "#6aa3ff",
  "#9b7dff",
  "#ff6b6b",
  "#ffce6b",
  "#5ad1a0",
  "#ff9b6b",
  "#6bd0ff",
  "#e36bff",
];

export function colorForProfile(p: Pick<Profile, "id" | "color">): string {
  if (p.color && p.color.trim()) return p.color;
  return AVATAR_COLORS[Math.abs(p.id) % AVATAR_COLORS.length];
}

interface Props {
  profile: Pick<Profile, "id" | "name" | "color" | "emoji">;
  size?: number;
}

export default function ProfileAvatar({ profile, size = 64 }: Props) {
  const bg = colorForProfile(profile);
  const content =
    profile.emoji && profile.emoji.trim()
      ? profile.emoji
      : (profile.name.trim()[0] ?? "?").toUpperCase();
  return (
    <span
      className="profile-avatar"
      style={{
        background: bg,
        width: size,
        height: size,
        fontSize: Math.round(size * 0.45),
      }}
      aria-hidden
    >
      {content}
    </span>
  );
}
