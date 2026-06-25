// Collection detection for catalog items.
//
// Some metadata addons (e.g. AIOMetadata) expose a "Collections" catalog whose
// items represent a *collection* of movies (e.g. "The Matrix Collection") rather
// than a single playable title. Opening one as a movie wrongly triggers the
// source/playback flow. We detect collection-like items generically (no
// hardcoded titles) so the UI can route them to a collection page instead.
//
// Pure module: no React/Electron imports.

import type { StremioCatalogItem, StremioMeta, StremioMetaVideo } from "./types.js";
import { unwrapAioBlurImageUrl } from "./episodeImage.js";

// Matches a "collection" token as its own segment in an id, e.g.
//   tmdb:collection:10   collection:603   tmdbc-collections-99
// but NOT ordinary movie/series ids like tt1375666 or 603.
const COLLECTION_ID_RE = /(?:^|[:._/-])collections?(?:[:._/-]|$)/i;

export function isCollectionItem(
  item: Pick<StremioCatalogItem, "id" | "type"> | null | undefined,
): boolean {
  if (!item) return false;
  const type = String(item.type ?? "").toLowerCase();
  if (type === "collection" || type === "collections") return true;
  const id = String(item.id ?? "");
  return COLLECTION_ID_RE.test(id);
}

/** Catalog the item was browsed from. Used to detect Collections catalogs. */
export interface CatalogContext {
  addonId?: string;
  catalogId?: string;
  catalogName?: string;
}

/**
 * True when the *catalog* the item came from is a collections catalog (e.g.
 * AIOMetadata's "Collections"). This is the reliable signal because collection
 * items themselves are often type "movie" with ordinary ids. Matches a
 * "collection"/"collections" token in the catalog id or name.
 */
export function isCollectionContext(ctx: CatalogContext | null | undefined): boolean {
  if (!ctx) return false;
  const hay = `${ctx.catalogId ?? ""} ${ctx.catalogName ?? ""}`;
  return /collections?/i.test(hay);
}

/** Combined check: collection by catalog context OR by item id/type heuristic. */
export function isCollection(
  item: Pick<StremioCatalogItem, "id" | "type"> | null | undefined,
  ctx?: CatalogContext | null,
): boolean {
  return isCollectionContext(ctx) || isCollectionItem(item);
}

/**
 * Route a catalog item to either the collection page or normal media detail.
 * When the item is a collection, the source addon id is carried as a query
 * param so the collection page can fetch its contents from the right addon.
 */
export function routeForCatalogItem(
  item: Pick<StremioCatalogItem, "id" | "type">,
  ctx?: CatalogContext | null,
): string {
  const enc = (s: string) => encodeURIComponent(s);
  if (isCollection(item, ctx)) {
    const q = ctx?.addonId ? `?addon=${enc(ctx.addonId)}` : "";
    return `/collection/${enc(item.type)}/${enc(item.id)}${q}`;
  }
  return `/media/${enc(item.type)}/${enc(item.id)}`;
}

/**
 * A collection member, with its image fields kept SEPARATE so the UI can choose
 * a real poster over a low-res thumbnail (and fetch the member's full meta
 * poster when neither is present). `poster` here is ONLY a genuine poster field
 * -- never a thumbnail/backdrop -- so callers can detect "no real poster".
 */
export interface CollectionMember {
  id: string;
  type: string;
  name: string;
  /** Genuine poster field from the member video, if present (never thumbnail). */
  poster?: string;
  /** Low-res still/thumbnail, used only as a last-resort image. */
  thumbnail?: string;
  background?: string;
  releaseInfo?: string;
}

/**
 * Extract the members of a collection from its meta object, if the addon
 * exposes them (usually under `meta.videos`). Members are assumed to be movies
 * unless the video declares its own type. Image fields are kept separate so the
 * caller can prefer a real poster and only fall back to the thumbnail.
 * Returns [] when no members are found.
 */
export function collectionMembers(meta: StremioMeta | null | undefined): CollectionMember[] {
  if (!meta) return [];
  const videos = Array.isArray(meta.videos) ? (meta.videos as StremioMetaVideo[]) : [];
  const out: CollectionMember[] = [];
  const seen = new Set<string>();
  for (const v of videos) {
    if (!v || typeof v.id !== "string") continue;
    if (seen.has(v.id)) continue;
    seen.add(v.id);
    const anyV = v as Record<string, unknown>;
    const str = (k: string): string | undefined =>
      typeof anyV[k] === "string" && (anyV[k] as string).length > 0 ? (anyV[k] as string) : undefined;
    // Unwrap AIOMetadata blur proxy URLs to the real artwork before use.
    const img = (k: string): string | undefined => {
      const s = str(k);
      return s ? unwrapAioBlurImageUrl(s) : undefined;
    };
    const type = str("type") ?? "movie";
    out.push({
      id: v.id,
      type,
      name: v.title ?? v.name ?? "Untitled",
      // Only a real poster field -- NOT thumbnail (that is the soft image bug).
      poster: img("poster"),
      thumbnail: img("thumbnail"),
      background: img("background"),
      releaseInfo: str("releaseInfo"),
    });
  }
  return out;
}
