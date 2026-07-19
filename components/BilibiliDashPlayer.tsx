import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Loader2, X } from "lucide-react";
import type Shaka from "shaka-player/dist/shaka-player.dash";

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
}

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

const createManifest = (dash: {
  video?: DashStream[];
  audio?: DashStream[];
  duration?: number;
}) => {
  const duration = Number(dash.duration || 0);
  const videoSet = createAdaptationSet(dash.video || [], "video");
  const audioSet = createAdaptationSet(dash.audio || [], "audio");
  if (!duration || !videoSet || !audioSet) {
    throw new Error("未找到浏览器可播放的 DASH 音视频流");
  }

  return `<?xml version="1.0" encoding="UTF-8"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" mediaPresentationDuration="PT${duration}S" minBufferTime="PT1.5S"><Period duration="PT${duration}S">${videoSet}${audioSet}</Period></MPD>`;
};

const fetchJsonWithRetry = async (url: string, signal: AbortSignal) => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { signal, credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error(`请求失败 (${response.status})`);
      return response.json();
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("网络请求失败");
};

export const BilibiliDashPlayer = ({
  bvid,
  title,
  onClose,
  onPrevious,
  onNext,
  hasPrevious = false,
  hasNext = false,
}: BilibiliDashPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [streamLabel, setStreamLabel] = useState("");

  useEffect(() => {
    if (!videoRef.current || !bvid) return;

    setError("");
    setIsLoading(true);
    setStreamLabel("");

    const videoElement = videoRef.current;
    const controller = new AbortController();
    let manifestUrl = "";
    let player: InstanceType<typeof Shaka.Player> | null = null;
    let disposed = false;

    const load = async () => {
      try {
        const { default: shaka } = await import("shaka-player/dist/shaka-player.dash");
        shaka.polyfill.installAll();
        if (!shaka.Player.isBrowserSupported()) {
          throw new Error("当前浏览器不支持 DASH 播放");
        }

        const viewResult = await fetchJsonWithRetry(
          `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
          controller.signal,
        );
        if (viewResult.code !== 0 || !viewResult.data?.cid) {
          throw new Error(viewResult.message || "获取视频信息失败");
        }

        const playResult = await fetchJsonWithRetry(
          `https://api.bilibili.com/x/player/playurl?fnval=16&bvid=${encodeURIComponent(bvid)}&cid=${viewResult.data.cid}`,
          controller.signal,
        );
        if (playResult.code !== 0 || !playResult.data?.dash) {
          throw new Error(playResult.message || "获取 DASH 播放地址失败");
        }

        const manifest = createManifest(playResult.data.dash);
        manifestUrl = URL.createObjectURL(new Blob([manifest], { type: "application/dash+xml" }));
        if (disposed) return;

        player = new shaka.Player(videoElement);
        player.configure({
          streaming: {
            bufferingGoal: 15,
            rebufferingGoal: 2,
            bufferBehind: 30,
          },
        });
        player.getNetworkingEngine()?.registerRequestFilter((_type, request) => {
          request.allowCrossSiteCredentials = true;
        });
        player.addEventListener("error", (event) => {
          const detail = (event as Event & { detail?: { code?: number; message?: string } }).detail;
          if (!disposed) {
            setError(detail?.message || `播放器错误 (${detail?.code || "未知"})`);
            setIsLoading(false);
          }
        });

        await player.load(manifestUrl);
        if (disposed) return;

        const activeTrack = player.getVariantTracks().find((track) => track.active);
        if (activeTrack) {
          setStreamLabel(
            `${activeTrack.width || "?"}×${activeTrack.height || "?"} · ${Math.round((activeTrack.bandwidth || 0) / 1000)} kbps`,
          );
        }
        setIsLoading(false);
        videoElement.play().catch(() => {
          // 浏览器可能要求用户再次点击播放控件，不影响已加载的视频。
        });
      } catch (loadError) {
        if (controller.signal.aborted || disposed) return;
        console.error("加载 Shaka DASH 视频失败:", loadError);
        setError(loadError instanceof Error ? loadError.message : "加载视频失败");
        setIsLoading(false);
      }
    };

    void load();

    return () => {
      disposed = true;
      controller.abort();
      videoElement.pause();
      void player?.destroy();
      if (manifestUrl) URL.revokeObjectURL(manifestUrl);
    };
  }, [bvid]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-5xl overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-neutral-900">
        <div className="flex items-center justify-between gap-4 border-b border-gray-100 px-5 py-4 dark:border-neutral-800">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{title}</h2>
            {streamLabel && <p className="mt-1 text-xs text-gray-500">{streamLabel}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
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
            <a
              href={`https://www.bilibili.com/video/${bvid}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-pink-500 dark:text-neutral-400 dark:hover:bg-neutral-800"
              title="在哔哩哔哩打开"
            >
              <ExternalLink className="h-5 w-5" />
            </a>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white"
              title="关闭播放器"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="relative aspect-video bg-black">
          <video
            ref={videoRef}
            controls
            playsInline
            onEnded={() => {
              if (hasNext) onNext?.();
            }}
            className="h-full w-full"
          />
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
  );
};
