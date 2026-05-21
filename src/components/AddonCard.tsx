import type { AddonRow } from "../types/preload.js";
import type { StremioResource } from "../core/stremio/types.js";

interface Props {
  addon: AddonRow;
  onRemove?: () => void;
}

function resourceName(r: StremioResource): string {
  return typeof r === "string" ? r : r.name;
}

export default function AddonCard({ addon, onRemove }: Props) {
  const m = addon.manifest;
  const resources = (m.resources ?? []).map(resourceName);
  const types = m.types ?? [];

  return (
    <article className="addon-card">
      <header className="addon-card__header">
        {m.logo ? (
          <img
            className="addon-card__logo"
            src={m.logo}
            alt=""
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
            }}
          />
        ) : (
          <div className="addon-card__logo addon-card__logo--placeholder" aria-hidden>
            {m.name.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="addon-card__title">
          <h3>{m.name}</h3>
          {m.version && <span className="version">v{m.version}</span>}
        </div>
      </header>

      {m.description && <p className="addon-card__description">{m.description}</p>}

      <div className="addon-card__meta">
        <div>
          <div className="label">Types</div>
          <div className="tags">
            {types.length > 0
              ? types.map((t) => <span key={t} className="tag">{t}</span>)
              : <span className="muted">none</span>}
          </div>
        </div>
        <div>
          <div className="label">Resources</div>
          <div className="tags">
            {resources.length > 0
              ? resources.map((r) => <span key={r} className="tag tag--alt">{r}</span>)
              : <span className="muted">none</span>}
          </div>
        </div>
      </div>

      <footer className="addon-card__footer">
        <a className="muted small" href={addon.manifestUrl} target="_blank" rel="noreferrer">
          {addon.manifestUrl}
        </a>
        {onRemove && (
          <button type="button" className="link-button" onClick={onRemove}>
            Remove
          </button>
        )}
      </footer>
    </article>
  );
}
