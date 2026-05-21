// "Sources" section on the media detail page. Takes a SelectedPlayableItem
// (movie id, or chosen series episode id) and fans out one stream fetch per
// stream-supporting addon for that exact id.
//
// For series, this means streams are fetched for the *episode* id, not the
// show id — which is what Stremio addons actually expect.

import { useCallback, useEffect, useMemo, useState } from "react";
import StreamCard from "./StreamCard.js";
import { addonSupportsResource } from "../core/stremio/meta.js";
import { streamDedupKey } from "../core/stremio/streams.js";
import type {
  SelectedPlayableItem,
  StreamSourceResult,
  StremioStream,
} from "../core/stremio/types.js";
import type { AddonRow } from "../types/preload.js";

interface Props {
  addons: AddonRow[];
  /**
   * Null for series that haven't had an episode picked yet. Movies always pass
   * a populated selection as soon as their meta resolves.
   */
  selected: SelectedPlayableItem | null;

  // Context needed by StreamCard to build a PlayableStream when the user hits
  // Play. Kept as flat props instead of stuffed into `selected` so the player
  // gets the show poster + show id alongside the per-episode info.
  mediaId: string;
  mediaTitle: string;
  mediaPoster?: string;
  /** For series: the chosen episode's own title (not the show title). */
  episodeTitle?: string;
  /** Resume position passed to MPV (--start); 0 starts from the beginning. */
  startSeconds?: number;
  /**
   * Layout variant:
   *  - "full" (default): bottom-of-page block for movies, with a big header.
   *  - "inline": compact, rendered inside the selected episode card on series.
   * Only affects presentation — fetching/dedup logic is identical.
   */
  variant?: "full" | "inline";
}

interface AddonFailure {
  addonId: string;
  addonName: string;
  message: string;
}

export default function SourcesSection({
  addons,
  selected,
  mediaId,
  mediaTitle,
  mediaPoster,
  episodeTitle,
  startSeconds,
  variant = "full",
}: Props) {
  const inline = variant === "inline";
  const eligible = useMemo(() => {
    if (!selected) return [];
    return addons.filter((a) =>
      addonSupportsResource(a.manifest, "stream", selected.type),
    );
  }, [addons, selected]);

  const [results, setResults] = useState<StreamSourceResult[]>([]);
  const [failures, setFailures] = useState<AddonFailure[]>([]);
  const [loading, setLoading] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const run = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    // Nothing selected (series with no episode picked) — clear and bail.
    if (!selected) {
      setResults([]);
      setFailures([]);
      setLoading(false);
      setCompleted(false);
      return;
    }

    if (eligible.length === 0) {
      setResults([]);
      setFailures([]);
      setLoading(false);
      setCompleted(true);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setResults([]);
    setFailures([]);
    setCompleted(false);

    const seen = new Set<string>();
    const collected: StreamSourceResult[] = [];
    const fails: AddonFailure[] = [];

    const tasks = eligible.map((a) =>
      window.mediaCenter.streams
        .fetch({
          manifestUrl: a.manifestUrl,
          type: selected.type,
          id: selected.id,
        })
        .then((res) => {
          if (cancelled) return;
          const streams = (res.streams ?? []) as StremioStream[];
          streams.forEach((s, i) => {
            const fallback = `${a.id}#${i}`;
            const key = streamDedupKey(s, fallback);
            if (seen.has(key)) return;
            seen.add(key);
            collected.push({
              stream: s,
              source: { addonId: a.id, addonName: a.manifest.name },
              key,
            });
          });
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          fails.push({
            addonId: a.id,
            addonName: a.manifest.name,
            message: e instanceof Error ? e.message : String(e),
          });
        }),
    );

    Promise.allSettled(tasks).then(() => {
      if (cancelled) return;
      setResults(collected);
      setFailures(fails);
      setLoading(false);
      setCompleted(true);
    });

    return () => {
      cancelled = true;
    };
  }, [eligible, selected, reloadKey]);

  // ---- Render --------------------------------------------------------------

  const sectionClass = `sources${inline ? " sources--inline" : ""}`;

  // Series with no episode picked yet.
  if (!selected) {
    return (
      <section className={sectionClass}>
        <header className="sources__header">
          <h2>Sources</h2>
        </header>
        <div className="empty">Select an episode to view sources.</div>
      </section>
    );
  }

  if (eligible.length === 0) {
    return (
      <section className={sectionClass}>
        {!inline && (
          <header className="sources__header">
            <h2>Sources</h2>
          </header>
        )}
        <div className="empty">
          None of your installed addons provide a <code>stream</code> resource
          for <code>{selected.type}</code>.
        </div>
      </section>
    );
  }

  // Season/episode are only meaningful when `selected` is a series pick.
  const season =
    selected.type === "series" ? selected.season : undefined;
  const episode =
    selected.type === "series" ? selected.episode : undefined;

  return (
    <section className={sectionClass}>
      <header className="sources__header">
        {inline ? (
          <span className="sources__inline-label">Sources</span>
        ) : (
          <h2>Sources</h2>
        )}
        <span className="muted small">
          {loading
            ? `Searching ${eligible.length} addon${eligible.length === 1 ? "" : "s"}…`
            : `${results.length} source${results.length === 1 ? "" : "s"} from ${eligible.length - failures.length}/${eligible.length} addon${eligible.length === 1 ? "" : "s"}`}
          {selected.type === "series" && typeof season === "number" && typeof episode === "number" && (
            <>
              {" "}· S{String(season).padStart(2, "0")}E{String(episode).padStart(2, "0")}
            </>
          )}
        </span>
        <span className="sources__spacer" />
        {!loading && (
          <button type="button" className="ghost-button" onClick={run}>
            Refresh
          </button>
        )}
      </header>

      {failures.length > 0 && (
        <div className="warning-banner" role="alert">
          {failures.length} addon{failures.length === 1 ? "" : "s"} couldn't be
          reached — showing results from the rest.
          <details>
            <summary>Details</summary>
            <ul className="failure-list">
              {failures.map((f, i) => (
                <li key={i}>
                  <strong>{f.addonName}:</strong> {f.message}
                </li>
              ))}
            </ul>
          </details>
          <div style={{ marginTop: 8 }}>
            <button type="button" className="ghost-button" onClick={run}>
              Retry failed addons
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div className="sources__list">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="stream-card stream-card--skeleton" aria-hidden>
              <div className="stream-card__main">
                <div className="skeleton-line" style={{ width: "40%" }} />
                <div className="skeleton-line" style={{ width: "80%" }} />
                <div className="skeleton-line skeleton-line--short" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && completed && results.length === 0 && failures.length === 0 && (
        <div className="empty">
          No sources found for {selected.type} <code>{selected.id}</code> in any
          installed addon.
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="sources__list">
          {results.map((r) => (
            <StreamCard
              key={r.key}
              result={r}
              type={selected.type}
              mediaId={mediaId}
              playableId={selected.id}
              mediaTitle={mediaTitle}
              mediaPoster={mediaPoster}
              episodeTitle={episodeTitle}
              season={season}
              episode={episode}
              startSeconds={startSeconds}
              subtitleAddons={addons}
            />
          ))}
        </div>
      )}
    </section>
  );
}
