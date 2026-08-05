import { HIDDEN_MENUS, THEME_MODE, VIDEO_CLICK_MODES } from "./constants";
import { getStorageValue, setStorageValue } from "./storage";
import { setTheme, type ThemeMode } from "./theme";
import type { VideoClickMode, VideoClickModes, VideoSource } from "../hooks/useVideoClickMode";

export interface SyncedPreferences {
  version: 1;
  theme: ThemeMode;
  hiddenMenus: string[];
  videoClickModes: VideoClickModes;
}

const DEFAULT_VIDEO_CLICK_MODES: VideoClickModes = {
  history: "bilibili",
  favorites: "bilibili",
  collections: "player",
};

const VIDEO_SOURCES: VideoSource[] = ["history", "favorites", "collections"];

const isVideoClickMode = (value: unknown): value is VideoClickMode =>
  value === "bilibili" || value === "player";

const normalizeVideoClickModes = (value: unknown): VideoClickModes => {
  const modes = value && typeof value === "object" ? value : {};

  return VIDEO_SOURCES.reduce(
    (result, source) => {
      const mode = (modes as Partial<Record<VideoSource, unknown>>)[source];
      result[source] = isVideoClickMode(mode) ? mode : DEFAULT_VIDEO_CLICK_MODES[source];
      return result;
    },
    { ...DEFAULT_VIDEO_CLICK_MODES },
  );
};

export const getSyncedPreferences = async (): Promise<SyncedPreferences> => {
  const [theme, hiddenMenus, videoClickModes] = await Promise.all([
    getStorageValue<ThemeMode>(THEME_MODE, "light"),
    getStorageValue<unknown>(HIDDEN_MENUS, []),
    getStorageValue<unknown>(VIDEO_CLICK_MODES, {}),
  ]);

  return {
    version: 1,
    theme: theme === "dark" ? "dark" : "light",
    hiddenMenus: Array.isArray(hiddenMenus)
      ? hiddenMenus.filter((menu): menu is string => typeof menu === "string")
      : [],
    videoClickModes: normalizeVideoClickModes(videoClickModes),
  };
};

export const parseSyncedPreferences = (value: unknown): SyncedPreferences | null => {
  if (!value || typeof value !== "object") return null;

  const preferences = value as Partial<SyncedPreferences>;
  if (preferences.theme !== "light" && preferences.theme !== "dark") return null;
  if (!Array.isArray(preferences.hiddenMenus)) return null;
  if (!preferences.hiddenMenus.every((menu) => typeof menu === "string")) return null;

  return {
    version: 1,
    theme: preferences.theme,
    hiddenMenus: preferences.hiddenMenus,
    videoClickModes: normalizeVideoClickModes(preferences.videoClickModes),
  };
};

export const applySyncedPreferences = async (preferences: SyncedPreferences): Promise<void> => {
  await Promise.all([
    setTheme(preferences.theme),
    setStorageValue(HIDDEN_MENUS, preferences.hiddenMenus),
    setStorageValue(VIDEO_CLICK_MODES, preferences.videoClickModes),
  ]);
};
