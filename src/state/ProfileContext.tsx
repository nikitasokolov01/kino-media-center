// Multi-profile state.
//
// On launch we load the profile list (the DB guarantees at least a "Default"
// profile) but DON'T auto-select one — App renders the ProfilePicker until a
// profile is chosen, Netflix-style. Once `profile` is set, the rest of the app
// keys all its data fetches off `profile.id`, so switching profiles (which
// just changes `profile`) naturally refreshes addons, catalogs, search,
// progress, and Continue Watching.
//
// `useProfile().profile` keeps the same shape existing components expect.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Profile } from "../types/preload.js";

interface CreateInput {
  name: string;
  color?: string | null;
  emoji?: string | null;
}
interface UpdateInput {
  name?: string;
  color?: string | null;
  emoji?: string | null;
}

interface ProfileContextValue {
  profiles: Profile[];
  /** The active profile, or null while the picker is showing. */
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  selectProfile: (id: number) => void;
  /** Return to the picker (used by the sidebar "Switch profile" action). */
  clearActiveProfile: () => void;
  createProfile: (input: CreateInput) => Promise<Profile>;
  updateProfile: (id: number, patch: UpdateInput) => Promise<Profile>;
  deleteProfile: (id: number) => Promise<{ ok: boolean; error?: string }>;
  refreshProfiles: () => Promise<Profile[]>;
}

const ProfileContext = createContext<ProfileContextValue | undefined>(undefined);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshProfiles = useCallback(async () => {
    try {
      const list = await window.mediaCenter.profile.list();
      setProfiles(list);
      setError(null);
      return list;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshProfiles();
  }, [refreshProfiles]);

  const selectProfile = useCallback((id: number) => {
    setActiveId(id);
  }, []);

  const clearActiveProfile = useCallback(() => {
    setActiveId(null);
  }, []);

  const createProfile = useCallback(
    async (input: CreateInput) => {
      const created = await window.mediaCenter.profile.create(input);
      await refreshProfiles();
      return created;
    },
    [refreshProfiles],
  );

  const updateProfile = useCallback(
    async (id: number, patch: UpdateInput) => {
      const updated = await window.mediaCenter.profile.update({ id, ...patch });
      await refreshProfiles();
      return updated;
    },
    [refreshProfiles],
  );

  const deleteProfile = useCallback(
    async (id: number) => {
      const res = await window.mediaCenter.profile.remove(id);
      if (res.ok) {
        // If the active profile was deleted, drop back to the picker.
        setActiveId((cur) => (cur === id ? null : cur));
        await refreshProfiles();
      }
      return res;
    },
    [refreshProfiles],
  );

  // Keep the active profile object in sync with the latest list (e.g. after a
  // rename/avatar edit), and drop it if it vanished.
  const profile = useMemo(
    () => profiles.find((p) => p.id === activeId) ?? null,
    [profiles, activeId],
  );

  const value = useMemo<ProfileContextValue>(
    () => ({
      profiles,
      profile,
      loading,
      error,
      selectProfile,
      clearActiveProfile,
      createProfile,
      updateProfile,
      deleteProfile,
      refreshProfiles,
    }),
    [
      profiles,
      profile,
      loading,
      error,
      selectProfile,
      clearActiveProfile,
      createProfile,
      updateProfile,
      deleteProfile,
      refreshProfiles,
    ],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used inside ProfileProvider");
  return ctx;
}
