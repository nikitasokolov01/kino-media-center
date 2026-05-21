// Temporary store for the in-flight playable stream.
//
// The player route is `/watch/:type/:id` and we deliberately don't put the
// full stream payload in the URL (it's far too long and would also be ugly to
// share). Instead, the source list calls `setPendingPlayable(p)` immediately
// before navigating, and the player reads it back via `getPendingPlayable()`.
//
// To survive a soft page reload during development we also mirror the payload
// into `sessionStorage`. If both are empty, the player shows a "no stream
// selected" state with a back button.

import type { PlayableStream } from "./types.js";

const STORAGE_KEY = "mediacenter.pendingPlayable";

let memory: PlayableStream | null = null;

function readSession(): PlayableStream | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PlayableStream;
  } catch {
    return null;
  }
}

function writeSession(p: PlayableStream | null) {
  try {
    if (p === null) {
      sessionStorage.removeItem(STORAGE_KEY);
    } else {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    }
  } catch {
    // sessionStorage isn't critical — failure here is non-fatal.
  }
}

export function setPendingPlayable(p: PlayableStream | null): void {
  memory = p;
  writeSession(p);
}

export function getPendingPlayable(): PlayableStream | null {
  if (memory) return memory;
  const restored = readSession();
  if (restored) memory = restored;
  return memory;
}

export function clearPendingPlayable(): void {
  memory = null;
  writeSession(null);
}
