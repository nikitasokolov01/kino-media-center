// A single custom right-click context menu shared app-wide. Components call
// `openContextMenu(x, y, items)` from an `onContextMenu` handler (after
// preventDefault) to show a popover at the cursor. Closes on outside click,
// Escape, scroll, or selecting an item. No native browser menu is used.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

interface MenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

interface ContextMenuContextValue {
  openContextMenu: (x: number, y: number, items: ContextMenuItem[]) => void;
  closeContextMenu: () => void;
}

const ContextMenuContext = createContext<ContextMenuContextValue | undefined>(
  undefined,
);

// Approximate menu size used to keep it inside the viewport.
const MENU_WIDTH = 220;
const ITEM_HEIGHT = 34;

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<MenuState | null>(null);

  const closeContextMenu = useCallback(() => setMenu(null), []);

  const openContextMenu = useCallback(
    (x: number, y: number, items: ContextMenuItem[]) => {
      if (items.length === 0) return;
      // Clamp so the menu doesn't overflow the window.
      const maxX = window.innerWidth - MENU_WIDTH - 8;
      const maxY = window.innerHeight - items.length * ITEM_HEIGHT - 8;
      setMenu({
        x: Math.max(8, Math.min(x, maxX)),
        y: Math.max(8, Math.min(y, maxY)),
        items,
      });
    },
    [],
  );

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeContextMenu();
    };
    const onScroll = () => closeContextMenu();
    window.addEventListener("keydown", onKey);
    // Capture scroll anywhere so the menu doesn't float away from its anchor.
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [menu, closeContextMenu]);

  const value = useMemo<ContextMenuContextValue>(
    () => ({ openContextMenu, closeContextMenu }),
    [openContextMenu, closeContextMenu],
  );

  return (
    <ContextMenuContext.Provider value={value}>
      {children}
      {menu && (
        <>
          {/* Full-screen catcher closes the menu on any outside click. */}
          <div
            className="context-menu__backdrop"
            onClick={closeContextMenu}
            onContextMenu={(e) => {
              e.preventDefault();
              closeContextMenu();
            }}
          />
          <div
            className="context-menu"
            style={{ left: menu.x, top: menu.y, width: MENU_WIDTH }}
            role="menu"
          >
            {menu.items.map((item, i) => (
              <button
                key={i}
                type="button"
                role="menuitem"
                className={`context-menu__item${item.danger ? " context-menu__item--danger" : ""}`}
                disabled={item.disabled}
                onClick={() => {
                  closeContextMenu();
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </ContextMenuContext.Provider>
  );
}

export function useContextMenu(): ContextMenuContextValue {
  const ctx = useContext(ContextMenuContext);
  if (!ctx) throw new Error("useContextMenu must be used inside ContextMenuProvider");
  return ctx;
}
