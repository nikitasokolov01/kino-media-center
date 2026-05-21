// A single horizontal catalog row on the Home page.
// Acts as a preview only — the user clicks "See all" to open the dedicated
// catalog page. Owns its own loading/error state so one broken addon never
// breaks the rest of the page.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import CatalogItem from "./CatalogItem.js";
import type { StremioCatalogItem } from "../core/stremio/types.js";

interface Props {
  addonId: string;
  addonName: string;
  catalogName: string;
  type: string;
  catalogId: string;
  manifestUrl: string;
}

const PREVIEW_LIMIT = 25;

export default function CatalogRow({
  addonId,
  addonName,
  catalogName,
  type,
  catalogId,
  manifestUrl,
}: Props) {
  const [items, setItems] = useState<StremioCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    window.mediaCenter.catalog
      .fetch({ manifestUrl, type, catalogId })
      .then((res) => {
        if (cancelled) return;
        setItems((res.metas ?? []).slice(0, PREVIEW_LIMIT));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [manifestUrl, type, catalogId]);

  const seeAllHref = `/catalog/${encodeURIComponent(addonId)}/${encodeURIComponent(type)}/${encodeURIComponent(catalogId)}`;

  return (
    <section className="catalog-row">
      <header className="catalog-row__header">
        <Link to={seeAllHref} className="catalog-row__title-link">
          <h2 className="catalog-row__title">{catalogName}</h2>
        </Link>
        <span className="catalog-row__addon">{addonName} · {type}</span>
        <span className="catalog-row__spacer" />
        <Link to={seeAllHref} className="catalog-row__see-all">
          See all →
        </Link>
      </header>

      {loading && (
        <div className="catalog-row__strip">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="catalog-item catalog-item--skeleton" aria-hidden>
              <div className="catalog-item__poster catalog-item__poster--skeleton" />
              <div className="skeleton-line" />
              <div className="skeleton-line skeleton-line--short" />
            </div>
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="catalog-row__error" role="alert">
          Couldn't load this catalog: {error}
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="catalog-row__empty">No items.</div>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="catalog-row__strip">
          {items.map((it) => (
            <CatalogItem key={`${it.type}:${it.id}`} item={it} />
          ))}
        </div>
      )}
    </section>
  );
}
