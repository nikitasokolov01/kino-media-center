// Profile-aware library membership. Loads the active profile's library once,
// keeps a Set of `${type}:${mediaId}` keys for instant `isInLibrary` checks,
// and exposes add/remove that keep the set in sync. Reloads whenever the
// active profile changes.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useProfile } from "./ProfileContext.js";
import type { LibraryItem } from "../types/preload.js";

export interface LibraryAddInput {
  type: string;
  mediaId: string;
  title: string;
  poster?: string | null;
  background?: string | null;
  releaseInfo?: string | null;
}

interface LibraryContextValue {
  items: LibraryItem[];
  loading: boolean;
  isInLibrary: (type: string, mediaId: string) => boolean;
  add: (input: LibraryAddInput) => Promise<void>;
  remove: (type: string, mediaId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

function key(type: string, mediaId: string): string {
  return `${type}:${mediaId}`;
}

const LibraryContext = createContext<LibraryContextValue | undefined>(undefined);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const { profile } = useProfile();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!profile) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await window.mediaCenter.library.list({ profileId: profile.id });
      setItems(list);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const memberKeys = useMemo(
    () => new Set(items.map((i) => key(i.type, i.mediaId))),
    [items],
  );

  const isInLibrary = useCallback(
    (type: string, mediaId: string) => memberKeys.has(key(type, mediaId)),
    [memberKeys],
  );

  const add = useCallback(
    async (input: LibraryAddInput) => {
      if (!profile) return;
      const created = await window.mediaCenter.library.add({
        profileId: profile.id,
        ...input,
      });
      setItems((prev) => {
        const without = prev.filter(
          (i) => !(i.type === created.type && i.mediaId === created.mediaId),
        );
        return [created, ...without];
      });
    },
    [profile],
  );

  const remove = useCallback(
    async (type: string, mediaId: string) => {
      if (!profile) return;
      await window.mediaCenter.library.remove({ profileId: profile.id, type, mediaId });
      setItems((prev) =>
        prev.filter((i) => !(i.type === type && i.mediaId === mediaId)),
      );
    },
    [profile],
  );

  const value = useMemo<LibraryContextValue>(
    () => ({ items, loading, isInLibrary, add, remove, refresh }),
    [items, loading, isInLibrary, add, remove, refresh],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryContextValue {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error("useLibrary must be used inside LibraryProvider");
  return ctx;
}
