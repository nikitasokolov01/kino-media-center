// Episode still/thumbnail image selection.
//
// Some addons (e.g. AIOMetadata) attach a blurred/spoiler variant or a tiny
// image to an episode's `thumbnail`, and may also provide clearer fields
// (`still`, `image`, `screenshot`). We always pick the CLEAREST available image
// here -- the Spoiler Blur setting controls blur via CSS, never by choosing a
// remote blurred image. As a last resort we fall back to the show backdrop.
//
// Pure module: no React/Electron imports.

import type { StremioMetaVideo } from "./types.js";

// URL markers that indicate a deliberately blurred / spoiler / preview variant.
const BLUR_MARKER_RE = /(blur|blurred|spoiler)/i;
// Tiny TMDB/image sizes we bump to a larger, sharper size when present.
const SMALL_SIZE_RE = /\/(w(?:45|92|154|185|220|300|342))\//;

export interface EpisodeImagePick {
  url: string | undefined;
  /** The chosen source field ("still" | "image" | ... | "show-backdrop" | "none"). */
  field: string;
  /** True when the only image available looked like a blurred/spoiler variant. */
  wasBlurredVariant: boolean;
}

export function urlLooksBlurred(url: string | undefined): boolean {
  return typeof url === "string" && BLUR_MARKER_RE.test(url);
}

/**
 * Unwrap an AIOMetadata image-blur proxy URL to the real, clear artwork URL.
 *   https://<host>/api/image/blur?url=<encoded clear url>  ->  <clear url>
 * Generic: matches any host whose path includes "/image/blur" and carries a
 * `url` query param. Returns the input unchanged if it is not such a URL or
 * if parsing fails.
 */
export function unwrapAioBlurImageUrl(input: string): string {
  try {
    const parsed = new URL(input);
    if (!parsed.pathname.includes("/image/blur")) return input;
    const encoded = parsed.searchParams.get("url");
    if (!encoded) return input;
    // URLSearchParams already decodes once; guard against double-encoding too.
    let decoded = encoded;
    try {
      if (/%[0-9a-f]{2}/i.test(decoded)) decoded = decodeURIComponent(decoded);
    } catch {
      /* keep as-is */
    }
    const decodedUrl = new URL(decoded);
    if (decodedUrl.protocol === "http:" || decodedUrl.protocol === "https:") {
      return decodedUrl.toString();
    }
    return input;
  } catch {
    return input;
  }
}

/**
 * Normalize an image URL: FIRST unwrap any AIOMetadata blur proxy, then strip
 * blur/spoiler query markers and bump tiny image sizes for sharper artwork.
 */
export function normalizeStillUrl(url: string): string {
  const unwrapped = unwrapAioBlurImageUrl(url);
  try {
    const u = new URL(unwrapped);
    for (const k of ["blur", "blurred", "spoiler", "preview"]) u.searchParams.delete(k);
    u.pathname = u.pathname.replace(SMALL_SIZE_RE, "/w780/");
    return u.toString();
  } catch {
    return unwrapped;
  }
}

/**
 * Choose the clearest episode still. Priority: explicit still fields, then
 * thumbnail, then poster, then the show backdrop. A field that looks like a
 * blurred/spoiler variant is skipped in favour of a clear one; if only a
 * blurred variant exists, its markers are stripped (best-effort) and the result
 * is flagged.
 */
export function pickEpisodeStill(
  v: StremioMetaVideo,
  opts?: { showBackdrop?: string },
): EpisodeImagePick {
  const anyV = v as Record<string, unknown>;
  const str = (k: string): string | undefined =>
    typeof anyV[k] === "string" && (anyV[k] as string).length > 0 ? (anyV[k] as string) : undefined;

  const raw: Array<{ field: string; original: string | undefined }> = [
    { field: "still", original: str("still") },
    { field: "image", original: str("image") },
    { field: "screenshot", original: str("screenshot") },
    { field: "thumbnail", original: str("thumbnail") },
    { field: "poster", original: str("poster") },
  ];

  // Normalize each candidate (this UNWRAPS AIOMetadata blur proxies first, so a
  // blurred thumbnail becomes the real clear URL). Track whether the original
  // was a blurred/proxy variant for diagnostics.
  const candidates = raw
    .filter((c) => !!c.original)
    .map((c) => ({
      field: c.field,
      url: normalizeStillUrl(c.original as string),
      wasBlurredVariant:
        urlLooksBlurred(c.original as string) ||
        (c.original as string).includes("/image/blur"),
    }));

  // Prefer a resolved URL that no longer looks blurred (proxies are unwrapped,
  // so they qualify here).
  const clear = candidates.find((c) => !urlLooksBlurred(c.url));
  if (clear) {
    return { url: clear.url, field: clear.field, wasBlurredVariant: clear.wasBlurredVariant };
  }
  if (candidates.length > 0) {
    const first = candidates[0];
    return { url: first.url, field: first.field, wasBlurredVariant: first.wasBlurredVariant };
  }

  // Final fallback: the show backdrop/poster (also unwrapped just in case).
  if (opts?.showBackdrop) {
    return { url: normalizeStillUrl(opts.showBackdrop), field: "show-backdrop", wasBlurredVariant: false };
  }
  return { url: undefined, field: "none", wasBlurredVariant: false };
}
