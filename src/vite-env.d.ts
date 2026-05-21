/// <reference types="vite/client" />
export {};

declare global {
  interface Window {
    electronAPI: {
      openInMpv: (payload: {
        url: string;
        title?: string;
        mediaTitle?: string;
        episodeTitle?: string;
      }) => Promise<{
        success: boolean;
        error?: string;
      }>;

      checkMpvAvailable: () => Promise<{
        available: boolean;
        version?: string;
        error?: string;
      }>;

      getMpvPath?: () => Promise<string>;
      setMpvPath?: (path: string) => Promise<{
        success: boolean;
        error?: string;
      }>;
    };
  }
}