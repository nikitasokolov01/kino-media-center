// Module-level store + event bus for the experimental embedded player (E3).
//
// `dispatchEmbeddedExperimental` (in playRequest.ts) stores a PlayRequest here.
// The EmbeddedPlayerOverlay subscribes and owns the IPC lifecycle (api.start/stop).
// ExperimentalEmbeddedPlayerPage is fully independent from this store — it calls
// the useEmbeddedPlayback hook directly via its own URL input.
//
// Intentionally NOT a React context — it must be reachable from
// `dispatchPlayRequest`, which is a plain async function, not a React component.

import type { PlayRequest } from "../../core/player/types.js";

type EmbeddedRequestListener = (req: PlayRequest | null) => void;

const listeners = new Set<EmbeddedRequestListener>();
let _current: PlayRequest | null = null;

/**
 * Store a new embedded play request and notify all subscribers
 * (i.e. EmbeddedPlayerOverlay if mounted). Called by dispatchEmbeddedExperimental.
 */
export function setEmbeddedPlayRequest(req: PlayRequest): void {
  _current = req;
  for (const l of listeners) l(req);
}

/**
 * Clear the current embedded play request and notify all subscribers.
 * Called by the overlay close button / ESC key. Triggers cleanup (api.stop).
 */
export function clearEmbeddedPlayRequest(): void {
  _current = null;
  for (const l of listeners) l(null);
}

/**
 * Get the current pending request synchronously (for overlay useState init).
 */
export function getEmbeddedPlayRequest(): PlayRequest | null {
  return _current;
}

/**
 * Subscribe to embedded play request changes. Callback receives the new
 * PlayRequest (non-null = start/switch, null = stop/close).
 * Returns an unsubscribe function; call it in the effect cleanup.
 */
export function subscribeEmbeddedPlayRequest(
  cb: EmbeddedRequestListener,
): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
