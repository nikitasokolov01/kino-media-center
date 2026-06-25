import { Link, useNavigate } from "react-router-dom";
import type { StremioCatalogItem } from "../core/stremio/types.js";
import { useLibrary } from "../state/LibraryContext.js";
import { useContextMenu } from "../state/ContextMenuContext.js";
import { useToast } from "../state/ToastContext.js";
import { useSettings } from "../state/SettingsContext.js";

interface Props {
  item: StremioCatalogItem;
}

function releaseLabel(item: StremioCatalogItem): string | null {
  if (item.releaseInfo) return String(item.releaseInfo);
  if (typeof item.year === "number") return String(item.year);
  return null;
}

export default function CatalogItem({ item }: Props) {
  const navigate = useNavigate();
  const { isInLibrary, add, remove } = useLibrary();
  const { openContextMenu } = useContextMenu();
  const { toast } = useToast();
  const { settings } = useSettings();

  const year = releaseLabel(item);
  const to = `/media/${encodeURIComponent(item.type)}/${encodeURIComponent(item.id)}`;
  const inLib = isInLibrary(item.type, item.id);

  // Layout: portrait posters, landscape backdrops, or auto (landscape when a
  // backdrop exists, else portrait). Landscape prefers the backdrop image and
  // falls back to the poster when no backdrop is available.
  const layout = settings.posterLayout;
  const landscape =
    layout === "landscape" || (layout === "auto" && !!item.background);
  const imageSrc = landscape ? item.background ?? item.poster : item.poster;

  function handleContextMenu(e: React.MouseEvent) {
    // Suppress the native menu and never navigate from a right-click.
    e.preventDefault();
    e.stopPropagation();
    openContextMenu(e.clientX, e.clientY, [
      { label: "Open Details", onSelect: () => navigate(to) },
      inLib
        ? {
            label: "Remove from Library",
            danger: true,
            onSelect: async () => {
              await remove(item.type, item.id);
              toast("Removed from Library");
            },
          }
        : {
            label: "Add to Library",
            onSelect: async () => {
              await add({
                type: item.type,
                mediaId: item.id,
                title: item.name,
                poster: item.poster ?? null,
                background: item.background ?? null,
                releaseInfo: year,
              });
              toast("Added to Library");
            },
          },
    ]);
  }

  return (
    <Link
      to={to}
      className={`catalog-item ${landscape ? "catalog-item--landscape" : "catalog-item--portrait"}`}
      title={item.name}
      draggable={false}
      onContextMenu={handleContextMenu}
    >
      <div className="catalog-item__poster-wrap">
        {imageSrc ? (
          <img
            className="catalog-item__poster"
            src={imageSrc}
            alt=""
            loading="lazy"
            draggable={false}
            onError={(e) => {
              const img = e.currentTarget as HTMLImageElement;
              img.style.display = "none";
              const wrap = img.parentElement;
              if (wrap) wrap.classList.add("catalog-item__poster-wrap--empty");
            }}
          />
        ) : (
          <div className="catalog-item__poster catalog-item__poster--placeholder" aria-hidden>
            {item.name.slice(0, 1).toUpperCase()}
          </div>
        )}
        {inLib && <div className="catalog-item__lib-badge" title="In your library">★</div>}
      </div>
      <div className="catalog-item__title" title={item.name}>{item.name}</div>
      {year && <div className="catalog-item__year">{year}</div>}
    </Link>
  );
}
