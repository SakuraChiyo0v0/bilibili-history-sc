import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Maximize,
  Minimize,
  Minimize2,
  Music,
  Pause,
  PictureInPicture2,
  Play,
  Shuffle,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type Shaka from "shaka-player/dist/shaka-player.dash";
import { DocumentPipPlayer, DOCUMENT_PIP_STYLES } from "./DocumentPipPlayer";

interface DocumentPictureInPictureController {
  window: Window | null;
  requestWindow: (options?: { width?: number; height?: number }) => Promise<Window>;
}

type WindowWithDocumentPictureInPicture = Window & {
  documentPictureInPicture?: DocumentPictureInPictureController;
};

interface DashSegmentBase {
  initialization?: string;
  Initialization?: string;
  index_range?: string;
  indexRange?: string;
}

interface DashStream {
  id?: number;
  base_url?: string;
  baseUrl?: string;
  backup_url?: string[];
  backupUrl?: string[];
  mime_type?: string;
  mimeType?: string;
  codecs?: string;
  bandwidth?: number;
  width?: number;
  height?: number;
  frame_rate?: string;
  frameRate?: string;
  segment_base?: DashSegmentBase;
  SegmentBase?: DashSegmentBase;
}

interface BilibiliDashPlayerProps {
  bvid: string;
  title: string;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  hasPrevious?: boolean;
  hasNext?: boolean;
  nextBvid?: string;
  isShuffleEnabled?: boolean;
  onToggleShuffle?: () => void;
}

interface DashPlayback {
  cover: string;
  author: string;
  dash: {
    video?: DashStream[];
    audio?: DashStream[];
    duration?: number;
  };
}

interface DashPlaybackCacheEntry {
  expiresAt: number;
  promise: Promise<DashPlayback>;
}

const DASH_PLAYBACK_CACHE_TTL = 5 * 60 * 1000;
const dashPlaybackCache = new Map<string, DashPlaybackCacheEntry>();

const escapeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const getStreamUrls = (stream: DashStream) =>
  Array.from(
    new Set(
      [
        stream.base_url,
        stream.baseUrl,
        ...(stream.backup_url || []),
        ...(stream.backupUrl || []),
      ].filter((url): url is string => Boolean(url)),
    ),
  );

const getSegmentBase = (stream: DashStream) => stream.segment_base || stream.SegmentBase;

const isStreamSupported = (stream: DashStream, type: "video" | "audio") => {
  const mimeType = stream.mime_type || stream.mimeType || `${type}/mp4`;
  const fullMimeType = stream.codecs ? `${mimeType}; codecs="${stream.codecs}"` : mimeType;
  return MediaSource.isTypeSupported(fullMimeType);
};

const createRepresentation = (stream: DashStream, type: "video" | "audio", index: number) => {
  const segmentBase = getSegmentBase(stream);
  const urls = getStreamUrls(stream);
  const initialization = segmentBase?.initialization || segmentBase?.Initialization;
  const indexRange = segmentBase?.index_range || segmentBase?.indexRange;
  if (!urls.length || !initialization || !indexRange) return "";

  const attributes = [
    `id="${type}-${stream.id || index}"`,
    `bandwidth="${stream.bandwidth || 1}"`,
    stream.codecs ? `codecs="${escapeXml(stream.codecs)}"` : "",
    type === "video" && stream.width ? `width="${stream.width}"` : "",
    type === "video" && stream.height ? `height="${stream.height}"` : "",
    type === "video" && (stream.frame_rate || stream.frameRate)
      ? `frameRate="${stream.frame_rate || stream.frameRate}"`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  return `<Representation ${attributes}>${urls
    .map((url) => `<BaseURL>${escapeXml(url)}</BaseURL>`)
    .join(
      "",
    )}<SegmentBase indexRange="${indexRange}"><Initialization range="${initialization}" /></SegmentBase></Representation>`;
};

const createAdaptationSet = (streams: DashStream[], type: "video" | "audio") => {
  const representations = streams
    .filter((stream) => isStreamSupported(stream, type))
    .map((stream, index) => createRepresentation(stream, type, index))
    .filter(Boolean)
    .join("");
  if (!representations) return "";

  return `<AdaptationSet contentType="${type}" mimeType="${type}/mp4" segmentAlignment="true" startWithSAP="1">${representations}</AdaptationSet>`;
};

const createManifest = (
  dash: {
    video?: DashStream[];
    audio?: DashStream[];
    duration?: number;
  },
  audioOnly: boolean,
) => {
  const duration = Number(dash.duration || 0);
  const videoSet = audioOnly ? "" : createAdaptationSet(dash.video || [], "video");
  const audioSet = createAdaptationSet(dash.audio || [], "audio");
  if (!duration || !audioSet || (!audioOnly && !videoSet)) {
    throw new Error("未找到浏览器可播放的 DASH 音视频流");
  }

  return `<?xml version="1.0" encoding="UTF-8"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" mediaPresentationDuration="PT${duration}S" minBufferTime="PT1.5S"><Period duration="PT${duration}S">${videoSet}${audioSet}</Period></MPD>`;
};

const fetchJsonWithRetry = async (url: string) => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error(`请求失败 (${response.status})`);
      const payload = await response.text();
      try {
        return JSON.parse(payload);
      } catch {
        throw new Error("B 站接口返回了非 JSON 内容，请稍后重试");
      }
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("网络请求失败");
};

const fetchDashPlayback = async (bvid: string): Promise<DashPlayback> => {
  const viewResult = await fetchJsonWithRetry(
    `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
  );
  if (viewResult.code !== 0 || !viewResult.data?.cid) {
    throw new Error(viewResult.message || "获取视频信息失败");
  }

  const playResult = await fetchJsonWithRetry(
    `https://api.bilibili.com/x/player/playurl?fnval=16&bvid=${encodeURIComponent(bvid)}&cid=${viewResult.data.cid}`,
  );
  if (playResult.code !== 0 || !playResult.data?.dash) {
    throw new Error(playResult.message || "获取 DASH 播放地址失败");
  }

  return {
    cover: viewResult.data.pic || "",
    author: viewResult.data.owner?.name || "",
    dash: playResult.data.dash,
  };
};

const getDashPlayback = (bvid: string) => {
  const cached = dashPlaybackCache.get(bvid);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = fetchDashPlayback(bvid).catch((error) => {
    dashPlaybackCache.delete(bvid);
    throw error;
  });
  dashPlaybackCache.set(bvid, {
    expiresAt: Date.now() + DASH_PLAYBACK_CACHE_TTL,
    promise,
  });
  return promise;
};

const formatTime = (time: number) => {
  if (!Number.isFinite(time) || time < 0) return "0:00";
  const hours = Math.floor(time / 3600);
  const minutes = Math.floor((time % 3600) / 60);
  const seconds = Math.floor(time % 60);
  const shortTime = `${minutes.toString().padStart(hours ? 2 : 1, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
  return hours ? `${hours}:${shortTime}` : shortTime;
};

const updateMediaSessionPosition = (mediaElement: HTMLVideoElement) => {
  if (!("mediaSession" in navigator)) return;
  if (!Number.isFinite(mediaElement.duration) || mediaElement.duration <= 0) return;

  try {
    navigator.mediaSession.setPositionState({
      duration: mediaElement.duration,
      playbackRate: mediaElement.playbackRate,
      position: Math.min(mediaElement.duration, Math.max(0, mediaElement.currentTime)),
    });
  } catch {
    // 部分浏览器虽提供 Media Session，但不支持同步播放进度。
  }
};

export const BilibiliDashPlayer = ({
  bvid,
  title,
  onClose,
  onPrevious,
  onNext,
  hasPrevious = false,
  hasNext = false,
  nextBvid,
  isShuffleEnabled = false,
  onToggleShuffle,
}: BilibiliDashPlayerProps) => {
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const videoHostRef = useRef<HTMLDivElement>(null);
  const documentPipVideoHostRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<InstanceType<typeof Shaka.Player> | null>(null);
  const resumeTimeRef = useRef<number | null>(null);
  const recoveryAttemptsRef = useRef(new Set<string>());
  const currentPlaybackKeyRef = useRef("");
  const miniPlayerDragRef = useRef<{ offsetX: number; offsetY: number } | null>(null);
  const documentPipWindowRef = useRef<Window | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [streamLabel, setStreamLabel] = useState("");
  const [cover, setCover] = useState("");
  const [author, setAuthor] = useState("");
  const [isMusicMode, setIsMusicMode] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isPictureInPicture, setIsPictureInPicture] = useState(false);
  const [documentPipWindow, setDocumentPipWindow] = useState<Window | null>(null);
  const [pictureInPictureError, setPictureInPictureError] = useState("");
  const [miniPlayerPosition, setMiniPlayerPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [playbackReloadVersion, setPlaybackReloadVersion] = useState(0);
  const [isPlayerReady, setIsPlayerReady] = useState(false);

  useEffect(() => {
    if (!nextBvid || nextBvid === bvid) return;
    void getDashPlayback(nextBvid).catch(() => {
      // 预取失败不影响当前视频播放，切换时仍会按正常流程请求。
    });
  }, [bvid, nextBvid]);

  useEffect(() => {
    const playbackKey = `${bvid}:${isMusicMode ? "audio" : "video"}`;
    if (currentPlaybackKeyRef.current === playbackKey) return;
    currentPlaybackKeyRef.current = playbackKey;
    recoveryAttemptsRef.current.clear();
  }, [bvid, isMusicMode]);

  useEffect(() => {
    const mediaElement = videoRef.current;
    if (!mediaElement) return;

    let disposed = false;

    const initialize = async () => {
      try {
        const { default: shaka } = await import("shaka-player/dist/shaka-player.dash");
        shaka.polyfill.installAll();
        if (!shaka.Player.isBrowserSupported()) {
          throw new Error("当前浏览器不支持 DASH 播放");
        }

        const player = new shaka.Player();
        player.configure({
          streaming: {
            bufferingGoal: 15,
            rebufferingGoal: 2,
            bufferBehind: 30,
            retryParameters: {
              maxAttempts: 3,
              baseDelay: 500,
              backoffFactor: 2,
              fuzzFactor: 0.5,
              timeout: 0,
              stallTimeout: 5000,
              connectionTimeout: 10000,
            },
          },
        });
        player.getNetworkingEngine()?.registerRequestFilter((_type, request) => {
          request.allowCrossSiteCredentials = true;
        });
        await player.attach(mediaElement);

        if (disposed) {
          await player.destroy();
          return;
        }
        playerRef.current = player;
        setIsPlayerReady(true);
      } catch (initializeError) {
        if (disposed) return;
        console.error("初始化 Shaka 播放器失败:", initializeError);
        setError(initializeError instanceof Error ? initializeError.message : "初始化播放器失败");
        setIsLoading(false);
      }
    };

    void initialize();

    return () => {
      disposed = true;
      const player = playerRef.current;
      playerRef.current = null;
      setIsPlayerReady(false);
      void player?.destroy();
    };
  }, []);

  // 使用原生媒体事件，确保 video 被移动到 Document PiP 文档后状态仍能同步。
  useEffect(() => {
    const mediaElement = videoRef.current;
    if (!mediaElement) return;

    const handleLoadedMetadata = () => {
      setDuration(mediaElement.duration);
      updateMediaSessionPosition(mediaElement);
    };
    const handleTimeUpdate = () => {
      setCurrentTime(mediaElement.currentTime);
      updateMediaSessionPosition(mediaElement);
    };
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleVolumeChange = () => {
      setVolume(mediaElement.volume);
      setIsMuted(mediaElement.muted);
    };
    const handleEnded = () => {
      if (hasNext && !mediaElement.loop) onNext?.();
    };

    mediaElement.addEventListener("loadedmetadata", handleLoadedMetadata);
    mediaElement.addEventListener("timeupdate", handleTimeUpdate);
    mediaElement.addEventListener("ratechange", handleTimeUpdate);
    mediaElement.addEventListener("play", handlePlay);
    mediaElement.addEventListener("pause", handlePause);
    mediaElement.addEventListener("volumechange", handleVolumeChange);
    mediaElement.addEventListener("ended", handleEnded);
    return () => {
      mediaElement.removeEventListener("loadedmetadata", handleLoadedMetadata);
      mediaElement.removeEventListener("timeupdate", handleTimeUpdate);
      mediaElement.removeEventListener("ratechange", handleTimeUpdate);
      mediaElement.removeEventListener("play", handlePlay);
      mediaElement.removeEventListener("pause", handlePause);
      mediaElement.removeEventListener("volumechange", handleVolumeChange);
      mediaElement.removeEventListener("ended", handleEnded);
    };
  }, [hasNext, onNext]);

  useEffect(() => {
    const mediaElement = videoRef.current;
    if (mediaElement) mediaElement.loop = isLooping;
  }, [isLooping]);

  useEffect(() => {
    const mediaElement = videoRef.current;
    const pageVideoHost = videoHostRef.current;
    if (!mediaElement || !pageVideoHost) return;

    if (documentPipWindow && !isMusicMode && documentPipVideoHostRef.current) {
      documentPipVideoHostRef.current.append(mediaElement);
    } else if (!pageVideoHost.contains(mediaElement)) {
      pageVideoHost.append(mediaElement);
    }

    return () => {
      if (!pageVideoHost.contains(mediaElement)) pageVideoHost.append(mediaElement);
    };
  }, [documentPipWindow, isMusicMode]);

  useEffect(
    () => () => {
      documentPipWindowRef.current?.close();
    },
    [],
  );

  useEffect(() => {
    const mediaElement = videoRef.current;
    const player = playerRef.current;
    if (!mediaElement || !player || !bvid || !isPlayerReady) return;

    setError("");
    setIsLoading(true);
    setStreamLabel("");

    const resumeTime = resumeTimeRef.current;
    resumeTimeRef.current = null;
    setIsPlaying(false);
    setCurrentTime(resumeTime || 0);
    setDuration(0);
    mediaElement.volume = volume;
    mediaElement.muted = isMuted;
    let manifestUrl = "";
    let disposed = false;
    let recoveryScheduled = false;

    const handlePlayerError = (event: Event) => {
      const detail = (
        event as Event & { detail?: { category?: number; code?: number; message?: string } }
      ).detail;
      const playbackKey = `${bvid}:${isMusicMode ? "audio" : "video"}`;
      if (
        !disposed &&
        !recoveryScheduled &&
        detail?.category === 1 &&
        !recoveryAttemptsRef.current.has(playbackKey)
      ) {
        recoveryScheduled = true;
        recoveryAttemptsRef.current.add(playbackKey);
        resumeTimeRef.current = mediaElement.currentTime;
        dashPlaybackCache.delete(bvid);
        setPlaybackReloadVersion((version) => version + 1);
        return;
      }
      if (recoveryScheduled) return;
      if (!disposed) {
        setError(detail?.message || `播放器错误 (${detail?.code || "未知"})`);
        setIsLoading(false);
      }
    };

    const load = async () => {
      try {
        const playback = await getDashPlayback(bvid);
        if (disposed) return;
        setCover(playback.cover);
        setAuthor(playback.author);

        const manifest = createManifest(playback.dash, isMusicMode);
        manifestUrl = URL.createObjectURL(new Blob([manifest], { type: "application/dash+xml" }));
        if (disposed) return;

        await player.load(manifestUrl, resumeTime ?? undefined);
        if (disposed) return;

        const activeTrack = player.getVariantTracks().find((track) => track.active);
        if (activeTrack) {
          setStreamLabel(
            isMusicMode
              ? `音乐模式 · ${Math.round((activeTrack.bandwidth || 0) / 1000)} kbps`
              : `${activeTrack.width || "?"}×${activeTrack.height || "?"} · ${Math.round((activeTrack.bandwidth || 0) / 1000)} kbps`,
          );
        }
        setIsLoading(false);
        mediaElement.play().catch(() => {
          // 浏览器可能要求用户再次点击播放控件，不影响已加载的视频。
        });
      } catch (loadError) {
        if (disposed) return;
        console.error("加载 Shaka DASH 视频失败:", loadError);
        setError(loadError instanceof Error ? loadError.message : "加载视频失败");
        setIsLoading(false);
      }
    };

    player.addEventListener("error", handlePlayerError);
    void load();

    return () => {
      disposed = true;
      player.removeEventListener("error", handlePlayerError);
      mediaElement.pause();
      if (manifestUrl) URL.revokeObjectURL(manifestUrl);
    };
  }, [bvid, isMusicMode, isPlayerReady, playbackReloadVersion]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === playerContainerRef.current);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    const mediaElement = videoRef.current;
    if (!mediaElement) return;

    const handleEnterPictureInPicture = () => {
      setIsPictureInPicture(true);
      setIsMinimized(true);
      setPictureInPictureError("");
    };
    const handleLeavePictureInPicture = () => setIsPictureInPicture(false);

    mediaElement.addEventListener("enterpictureinpicture", handleEnterPictureInPicture);
    mediaElement.addEventListener("leavepictureinpicture", handleLeavePictureInPicture);
    return () => {
      mediaElement.removeEventListener("enterpictureinpicture", handleEnterPictureInPicture);
      mediaElement.removeEventListener("leavepictureinpicture", handleLeavePictureInPicture);
    };
  }, []);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;

    const mediaSession = navigator.mediaSession;
    mediaSession.metadata = new MediaMetadata({
      title,
      artist: "Bilibili 无限历史记录",
      artwork: cover
        ? [
            {
              src: `${cover.replace("http:", "https:")}@512w_512h_1c.avif`,
              sizes: "512x512",
            },
          ]
        : [],
    });

    const setActionHandler = (
      action: MediaSessionAction,
      handler: MediaSessionActionHandler | null,
    ) => {
      try {
        mediaSession.setActionHandler(action, handler);
      } catch {
        // 浏览器可能只实现了部分 Media Session action。
      }
    };

    setActionHandler("play", () => void videoRef.current?.play());
    setActionHandler("pause", () => videoRef.current?.pause());
    setActionHandler("previoustrack", hasPrevious ? () => onPrevious?.() : null);
    setActionHandler("nexttrack", hasNext ? () => onNext?.() : null);
    setActionHandler("seekbackward", (details) => {
      const mediaElement = videoRef.current;
      if (!mediaElement) return;
      seekTo(Math.max(0, mediaElement.currentTime - (details.seekOffset || 10)));
    });
    setActionHandler("seekforward", (details) => {
      const mediaElement = videoRef.current;
      if (!mediaElement) return;
      seekTo(
        Math.min(
          mediaElement.duration || Infinity,
          mediaElement.currentTime + (details.seekOffset || 10),
        ),
      );
    });
    setActionHandler("seekto", (details) => {
      if (typeof details.seekTime === "number") seekTo(details.seekTime);
    });
    setActionHandler("stop", () => {
      videoRef.current?.pause();
      onClose();
    });

    return () => {
      (
        [
          "play",
          "pause",
          "previoustrack",
          "nexttrack",
          "seekbackward",
          "seekforward",
          "seekto",
          "stop",
        ] as MediaSessionAction[]
      ).forEach((action) => setActionHandler(action, null));
      mediaSession.metadata = null;
    };
  }, [cover, hasNext, hasPrevious, onNext, onPrevious, title]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  }, [isPlaying]);

  const toggleMusicMode = () => {
    const nextIsMusicMode = !isMusicMode;
    resumeTimeRef.current = videoRef.current?.currentTime || 0;
    if (documentPipWindowRef.current) {
      try {
        documentPipWindowRef.current.resizeTo(
          nextIsMusicMode ? 820 : 720,
          nextIsMusicMode ? 180 : 480,
        );
      } catch {
        // 浏览器可能拒绝调整系统画中画窗口尺寸，不影响模式切换。
      }
    }
    setIsMusicMode(nextIsMusicMode);
  };

  const getMediaElement = () => videoRef.current;

  const togglePlayback = () => {
    const mediaElement = getMediaElement();
    if (!mediaElement) return;
    if (mediaElement.paused) {
      void mediaElement.play();
    } else {
      mediaElement.pause();
    }
  };

  const seekTo = (time: number) => {
    const mediaElement = getMediaElement();
    if (!mediaElement) return;
    mediaElement.currentTime = time;
    setCurrentTime(time);
  };

  const setMediaVolume = (nextVolume: number) => {
    const mediaElement = getMediaElement();
    if (!mediaElement) return;
    mediaElement.volume = nextVolume;
    mediaElement.muted = nextVolume === 0;
    setVolume(nextVolume);
    setIsMuted(nextVolume === 0);
  };

  const toggleMute = () => {
    const mediaElement = getMediaElement();
    if (!mediaElement) return;
    mediaElement.muted = !mediaElement.muted;
    setIsMuted(mediaElement.muted);
  };

  const toggleLoop = () => setIsLooping((current) => !current);

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await playerContainerRef.current?.requestFullscreen();
    }
  };

  const documentPictureInPictureController = (window as WindowWithDocumentPictureInPicture)
    .documentPictureInPicture;
  const isDocumentPictureInPictureSupported = Boolean(documentPictureInPictureController);
  const isStandardPictureInPictureSupported =
    typeof document !== "undefined" &&
    document.pictureInPictureEnabled &&
    typeof HTMLVideoElement !== "undefined" &&
    "requestPictureInPicture" in HTMLVideoElement.prototype;

  const closeDocumentPictureInPicture = () => documentPipWindowRef.current?.close();

  const openDocumentPictureInPicture = async () => {
    if (!documentPictureInPictureController) return;
    if (documentPipWindowRef.current) {
      documentPipWindowRef.current.focus();
      return;
    }

    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    const pipWindow = await documentPictureInPictureController.requestWindow({
      width: isMusicMode ? 820 : 720,
      height: isMusicMode ? 180 : 480,
    });
    pipWindow.document.title = `${title} - Bilibili 无限历史记录`;

    const meta = pipWindow.document.createElement("meta");
    meta.name = "viewport";
    meta.content = "width=device-width,initial-scale=1";
    pipWindow.document.head.append(meta);

    const style = pipWindow.document.createElement("style");
    style.textContent = DOCUMENT_PIP_STYLES;
    pipWindow.document.head.append(style);

    const root = pipWindow.document.createElement("div");
    root.id = "document-pip-root";
    pipWindow.document.body.append(root);

    documentPipWindowRef.current = pipWindow;
    setDocumentPipWindow(pipWindow);
    setIsMinimized(true);
    setPictureInPictureError("");

    pipWindow.addEventListener(
      "pagehide",
      () => {
        const mediaElement = videoRef.current;
        const pageVideoHost = videoHostRef.current;
        if (mediaElement && pageVideoHost && !pageVideoHost.contains(mediaElement)) {
          pageVideoHost.append(mediaElement);
        }
        documentPipWindowRef.current = null;
        setDocumentPipWindow(null);
      },
      { once: true },
    );
  };

  const togglePictureInPicture = async () => {
    const mediaElement = videoRef.current;
    if (!mediaElement) return;

    setPictureInPictureError("");
    try {
      if (isDocumentPictureInPictureSupported) {
        if (documentPipWindowRef.current) closeDocumentPictureInPicture();
        else await openDocumentPictureInPicture();
        return;
      }

      if (!isStandardPictureInPictureSupported || isMusicMode) return;
      if (document.pictureInPictureElement === mediaElement) {
        await document.exitPictureInPicture();
      } else {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        await mediaElement.requestPictureInPicture();
      }
    } catch (pictureInPictureException) {
      console.error("进入系统画中画失败:", pictureInPictureException);
      setPictureInPictureError(
        pictureInPictureException instanceof Error
          ? pictureInPictureException.message
          : "当前浏览器无法进入系统画中画",
      );
    }
  };

  const closePlayer = async () => {
    closeDocumentPictureInPicture();
    if (document.pictureInPictureElement === videoRef.current) {
      try {
        await document.exitPictureInPicture();
      } catch {
        // 即使系统窗口已经关闭，也继续关闭页面内播放器。
      }
    }
    onClose();
  };

  const handleMiniPlayerPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isMinimized || event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button, a, input")) return;

    const rect = playerContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    miniPlayerDragRef.current = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleMiniPlayerPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = miniPlayerDragRef.current;
    const player = playerContainerRef.current;
    if (!isMinimized || !drag || !player) return;

    const padding = 8;
    const maxLeft = Math.max(padding, window.innerWidth - player.offsetWidth - padding);
    const maxTop = Math.max(padding, window.innerHeight - player.offsetHeight - padding);
    setMiniPlayerPosition({
      left: Math.min(maxLeft, Math.max(padding, event.clientX - drag.offsetX)),
      top: Math.min(maxTop, Math.max(padding, event.clientY - drag.offsetY)),
    });
  };

  const handleMiniPlayerPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    miniPlayerDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const canUseSystemPictureInPicture =
    isDocumentPictureInPictureSupported || (isStandardPictureInPictureSupported && !isMusicMode);
  const isAnySystemPictureInPicture = Boolean(documentPipWindow) || isPictureInPicture;
  const documentPipRoot = documentPipWindow?.document.getElementById("document-pip-root");

  return (
    <>
      <div
        className={
          documentPipWindow
            ? "hidden"
            : isMinimized
              ? "fixed bottom-5 right-5 z-[70] w-[min(420px,calc(100vw-2rem))]"
              : "fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        }
        style={
          isMinimized && miniPlayerPosition
            ? {
                left: miniPlayerPosition.left,
                top: miniPlayerPosition.top,
                right: "auto",
                bottom: "auto",
              }
            : undefined
        }
      >
        <div
          ref={playerContainerRef}
          className={`w-full overflow-hidden bg-white shadow-2xl dark:bg-neutral-900 ${
            isMinimized
              ? "rounded-2xl ring-1 ring-black/10 dark:ring-white/10"
              : "max-w-5xl rounded-xl"
          }`}
        >
          <div
            onPointerDown={handleMiniPlayerPointerDown}
            onPointerMove={handleMiniPlayerPointerMove}
            onPointerUp={handleMiniPlayerPointerUp}
            onPointerCancel={handleMiniPlayerPointerUp}
            className={`flex items-center justify-between border-b border-gray-100 dark:border-neutral-800 ${
              isMinimized ? "cursor-move touch-none select-none gap-2 px-3 py-2" : "gap-4 px-5 py-4"
            }`}
          >
            <div className="min-w-0">
              <h2 className={`truncate font-semibold ${isMinimized ? "text-sm" : "text-base"}`}>
                {title}
              </h2>
              {!isMinimized && streamLabel && (
                <p className="mt-1 text-xs text-gray-500">{streamLabel}</p>
              )}
              {pictureInPictureError && (
                <p className="mt-1 truncate text-xs text-red-500" title={pictureInPictureError}>
                  系统画中画启动失败：{pictureInPictureError}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {!isMinimized && (
                <>
                  <button
                    type="button"
                    onClick={onPrevious}
                    disabled={!hasPrevious}
                    className="rounded-md p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-35 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white"
                    title="上一个视频"
                    aria-label="上一个视频"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={onNext}
                    disabled={!hasNext}
                    className="rounded-md p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-35 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white"
                    title="下一个视频"
                    aria-label="下一个视频"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={onToggleShuffle}
                    disabled={!onToggleShuffle}
                    className={`rounded-md p-2 transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                      isShuffleEnabled
                        ? "bg-pink-50 text-pink-500 dark:bg-pink-500/15 dark:text-pink-300"
                        : "text-gray-500 hover:bg-gray-100 hover:text-pink-500 dark:text-neutral-400 dark:hover:bg-neutral-800"
                    }`}
                    title={isShuffleEnabled ? "关闭随机播放" : "随机播放"}
                    aria-label={isShuffleEnabled ? "关闭随机播放" : "随机播放"}
                  >
                    <Shuffle className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={toggleMusicMode}
                    className={`rounded-md p-2 transition-colors ${
                      isMusicMode
                        ? "bg-pink-50 text-pink-500 dark:bg-pink-500/15 dark:text-pink-300"
                        : "text-gray-500 hover:bg-gray-100 hover:text-pink-500 dark:text-neutral-400 dark:hover:bg-neutral-800"
                    }`}
                    title={isMusicMode ? "切换为视频模式" : "音乐模式"}
                    aria-label={isMusicMode ? "切换为视频模式" : "音乐模式"}
                  >
                    <Music className="h-5 w-5" />
                  </button>
                  <a
                    href={`https://www.bilibili.com/video/${bvid}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-pink-500 dark:text-neutral-400 dark:hover:bg-neutral-800"
                    title="在哔哩哔哩打开"
                  >
                    <ExternalLink className="h-5 w-5" />
                  </a>
                </>
              )}
              <button
                type="button"
                onClick={() => void togglePictureInPicture()}
                disabled={!canUseSystemPictureInPicture || isLoading || Boolean(error)}
                className={`rounded-md p-2 transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                  isAnySystemPictureInPicture
                    ? "bg-pink-50 text-pink-500 dark:bg-pink-500/15 dark:text-pink-300"
                    : "text-gray-500 hover:bg-gray-100 hover:text-pink-500 dark:text-neutral-400 dark:hover:bg-neutral-800"
                }`}
                title={
                  !canUseSystemPictureInPicture
                    ? "当前浏览器不支持系统画中画"
                    : isAnySystemPictureInPicture
                      ? "退出系统画中画"
                      : isDocumentPictureInPictureSupported
                        ? "自定义系统画中画"
                        : "系统画中画"
                }
                aria-label={isAnySystemPictureInPicture ? "退出系统画中画" : "进入系统画中画"}
              >
                <PictureInPicture2 className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => setIsMinimized((current) => !current)}
                className="rounded-md p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-pink-500 dark:text-neutral-400 dark:hover:bg-neutral-800"
                title={isMinimized ? "展开播放器" : "缩小为悬浮窗"}
                aria-label={isMinimized ? "展开播放器" : "缩小为悬浮窗"}
              >
                {isMinimized ? <Maximize className="h-5 w-5" /> : <Minimize2 className="h-5 w-5" />}
              </button>
              <button
                type="button"
                onClick={() => void closePlayer()}
                className="rounded-md p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white"
                title="关闭播放器"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="relative aspect-video bg-black">
            <div ref={videoHostRef} className="h-full w-full">
              <video ref={videoRef} playsInline className="h-full w-full" />
            </div>
            {isMusicMode && (
              <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-neutral-950">
                {cover ? (
                  <img
                    src={`${cover.replace("http:", "https:")}@960w_540h_1c.avif`}
                    alt={title}
                    className="h-full w-full object-cover opacity-75"
                  />
                ) : (
                  <Music className="h-16 w-16 text-white/60" />
                )}
                <div className="absolute inset-0 bg-black/20" />
              </div>
            )}
            <div
              className={`absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 via-black/50 to-transparent text-white ${
                isMinimized ? "px-3 pb-2 pt-8" : "px-5 pb-4 pt-10"
              }`}
            >
              <div className="flex items-center gap-3">
                {isMinimized && (
                  <button
                    type="button"
                    onClick={onPrevious}
                    disabled={!hasPrevious}
                    className="rounded-full p-1 transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-35"
                    title="上一个视频"
                    aria-label="上一个视频"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={togglePlayback}
                  disabled={isLoading || Boolean(error)}
                  className="rounded-full p-1.5 transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                  title={isPlaying ? "暂停" : "播放"}
                  aria-label={isPlaying ? "暂停" : "播放"}
                >
                  {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                </button>
                {isMinimized && (
                  <button
                    type="button"
                    onClick={onNext}
                    disabled={!hasNext}
                    className="rounded-full p-1 transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-35"
                    title="下一个视频"
                    aria-label="下一个视频"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                )}
                <span
                  className={`${isMinimized ? "w-10" : "w-20 text-center"} shrink-0 font-mono text-xs tabular-nums`}
                >
                  {isMinimized
                    ? formatTime(currentTime)
                    : `${formatTime(currentTime)} / ${formatTime(duration)}`}
                </span>
                <input
                  type="range"
                  min="0"
                  max={duration || 0}
                  step="0.1"
                  value={Math.min(currentTime, duration || 0)}
                  onChange={(event) => seekTo(Number(event.target.value))}
                  disabled={!duration || isLoading || Boolean(error)}
                  aria-label="播放进度"
                  className="h-1 min-w-0 flex-1 cursor-pointer accent-pink-500 disabled:cursor-not-allowed disabled:opacity-40"
                />
                <button
                  type="button"
                  onClick={toggleMute}
                  className="rounded-full p-1.5 transition-colors hover:bg-white/15"
                  title={isMuted || volume === 0 ? "取消静音" : "静音"}
                  aria-label={isMuted || volume === 0 ? "取消静音" : "静音"}
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="h-5 w-5" />
                  ) : (
                    <Volume2 className="h-5 w-5" />
                  )}
                </button>
                {!isMinimized && (
                  <>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={isMuted ? 0 : volume}
                      onChange={(event) => setMediaVolume(Number(event.target.value))}
                      aria-label="音量"
                      className="h-1 w-20 cursor-pointer accent-pink-500"
                    />
                    <button
                      type="button"
                      onClick={() => void toggleFullscreen()}
                      className="rounded-full p-1.5 transition-colors hover:bg-white/15"
                      title={isFullscreen ? "退出全屏" : "全屏"}
                      aria-label={isFullscreen ? "退出全屏" : "全屏"}
                    >
                      {isFullscreen ? (
                        <Minimize className="h-5 w-5" />
                      ) : (
                        <Maximize className="h-5 w-5" />
                      )}
                    </button>
                  </>
                )}
              </div>
            </div>
            {isLoading && !error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/50 text-sm text-white">
                <Loader2 className="h-7 w-7 animate-spin" />
                正在加载 DASH 视频流...
              </div>
            )}
            {error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-sm text-white">
                <p>{error}</p>
                <a
                  href={`https://www.bilibili.com/video/${bvid}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md bg-white/15 px-3 py-2 hover:bg-white/25"
                >
                  前往哔哩哔哩播放
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
      {documentPipWindow &&
        documentPipRoot &&
        createPortal(
          <DocumentPipPlayer
            title={title}
            author={author}
            cover={cover}
            isMusicMode={isMusicMode}
            isPlaying={isPlaying}
            isLoading={isLoading}
            error={error}
            isMuted={isMuted || volume === 0}
            isLooping={isLooping}
            isShuffleEnabled={isShuffleEnabled}
            currentTime={currentTime}
            duration={duration}
            hasPrevious={hasPrevious}
            hasNext={hasNext}
            videoHostRef={documentPipVideoHostRef}
            onTogglePlayback={togglePlayback}
            onPrevious={onPrevious}
            onNext={onNext}
            onSeek={seekTo}
            onToggleMute={toggleMute}
            onToggleLoop={toggleLoop}
            onToggleShuffle={onToggleShuffle}
            onToggleMode={toggleMusicMode}
            onClose={closeDocumentPictureInPicture}
          />,
          documentPipRoot,
        )}
    </>
  );
};
