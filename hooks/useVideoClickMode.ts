import { useEffect, useState } from "react";
import { VIDEO_CLICK_MODES } from "../utils/constants";
import { getStorageValue } from "../utils/storage";

export type VideoSource = "history" | "favorites" | "collections";
export type VideoClickMode = "bilibili" | "player";

export type VideoClickModes = Record<VideoSource, VideoClickMode>;

export const DEFAULT_VIDEO_CLICK_MODES: VideoClickModes = {
  history: "bilibili",
  favorites: "bilibili",
  collections: "player",
};

export const normalizeVideoClickModes = (modes?: Partial<VideoClickModes>): VideoClickModes => ({
  ...DEFAULT_VIDEO_CLICK_MODES,
  ...modes,
});

export const useVideoClickMode = (source: VideoSource) => {
  const [modes, setModes] = useState<VideoClickModes>(DEFAULT_VIDEO_CLICK_MODES);

  useEffect(() => {
    const loadModes = async () => {
      const storedModes = await getStorageValue<Partial<VideoClickModes>>(VIDEO_CLICK_MODES, {});
      setModes(normalizeVideoClickModes(storedModes));
    };

    const handleStorageChange = (
      changes: { [key: string]: Browser.storage.StorageChange },
      areaName: string,
    ) => {
      if (areaName !== "local" || !changes[VIDEO_CLICK_MODES]) return;
      setModes(
        normalizeVideoClickModes(changes[VIDEO_CLICK_MODES].newValue as Partial<VideoClickModes>),
      );
    };

    void loadModes();
    browser.storage.onChanged.addListener(handleStorageChange);
    return () => browser.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  return modes[source];
};
