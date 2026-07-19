import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Loader2, X } from "lucide-react";

interface DashStream {
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

const getMimeType = (stream: DashStream, fallback: "video" | "audio") => {
  const mimeType = stream.mime_type || stream.mimeType || `${fallback}/mp4`;
  return stream.codecs ? `${mimeType}; codecs="${stream.codecs}"` : mimeType;
};

const waitForSourceOpen = (mediaSource: MediaSource) =>
  new Promise<void>((resolve, reject) => {
    mediaSource.addEventListener("sourceopen", () => resolve(), { once: true });
    mediaSource.addEventListener("sourceended", () => reject(new Error("媒体源已结束")), {
      once: true,
    });
  });

const updateBuffer = (sourceBuffer: SourceBuffer, action: () => void) =>
  new Promise<void>((resolve, reject) => {
    const handleUpdateEnd = () => resolve();
    const handleError = () => reject(new Error("媒体流写入失败"));

    sourceBuffer.addEventListener("updateend", handleUpdateEnd, { once: true });
    sourceBuffer.addEventListener("error", handleError, { once: true });
    action();
  });

const appendBuffer = (sourceBuffer: SourceBuffer, buffer: BufferSource) =>
  updateBuffer(sourceBuffer, () => sourceBuffer.appendBuffer(buffer));

const trimPlayedBuffer = async (sourceBuffer: SourceBuffer, currentTime: number) => {
  if (!sourceBuffer.buffered.length) return;

  const start = sourceBuffer.buffered.start(0);
  const trimEnd = currentTime - 30;
  if (trimEnd > start) {
    await updateBuffer(sourceBuffer, () => sourceBuffer.remove(start, trimEnd));
  }
};

const fetchJsonWithRetry = async (url: string, signal: AbortSignal) => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { signal });
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

const streamToSourceBuffer = (
  urls: string[],
  sourceBuffer: SourceBuffer,
  videoElement: HTMLVideoElement,
  signal: AbortSignal,
) => {
  let resolveStarted: () => void = () => undefined;
  let rejectStarted: (reason?: unknown) => void = () => undefined;
  const started = new Promise<void>((resolve, reject) => {
    resolveStarted = resolve;
    rejectStarted = reject;
  });

  const completed = (async () => {
    let hasAppended = false;
    try {
      let response: Response | undefined;
      let lastError: unknown;
      for (const url of urls) {
        try {
          const candidate = await fetch(url, { signal });
          if (!candidate.ok) throw new Error(`媒体流请求失败 (${candidate.status})`);
          response = candidate;
          break;
        } catch (error) {
          if (signal.aborted) throw error;
          lastError = error;
        }
      }
      if (!response) {
        throw lastError instanceof Error ? lastError : new Error("加载媒体流失败");
      }

      if (!response.body) {
        const data = await response.arrayBuffer();
        await appendBuffer(sourceBuffer, data);
        hasAppended = true;
        resolveStarted();
        return;
      }

      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.byteLength) continue;

        await trimPlayedBuffer(sourceBuffer, videoElement.currentTime);
        await appendBuffer(sourceBuffer, value);
        if (!hasAppended) {
          hasAppended = true;
          resolveStarted();
        }
      }

      if (!hasAppended) throw new Error("媒体流为空");
    } catch (streamError) {
      if (!hasAppended) rejectStarted(streamError);
      throw streamError;
    }
  })();

  // 在播放器关闭导致中止时，completed 可能不再被调用方 await。
  void completed.catch(() => undefined);

  return { started, completed };
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
    let objectUrl = "";
    let disposed = false;

    const load = async () => {
      try {
        if (!window.MediaSource) throw new Error("当前浏览器不支持分离音视频播放");

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
        if (playResult.code !== 0) throw new Error(playResult.message || "获取播放地址失败");

        const dash = playResult.data?.dash;
        const videoStream = dash?.video?.find((stream: DashStream) =>
          MediaSource.isTypeSupported(getMimeType(stream, "video")),
        );
        const audioStream = dash?.audio?.find((stream: DashStream) =>
          MediaSource.isTypeSupported(getMimeType(stream, "audio")),
        );
        const videoUrls = videoStream ? getStreamUrls(videoStream) : [];
        const audioUrls = audioStream ? getStreamUrls(audioStream) : [];

        if (!videoStream || !audioStream || !videoUrls.length || !audioUrls.length) {
          throw new Error("未找到浏览器可播放的音频或视频流");
        }

        setStreamLabel(
          `${videoStream.width || "?"}×${videoStream.height || "?"} · ${Math.round((videoStream.bandwidth || 0) / 1000)} kbps`,
        );

        const mediaSource = new MediaSource();
        objectUrl = URL.createObjectURL(mediaSource);
        videoElement.src = objectUrl;

        await waitForSourceOpen(mediaSource);
        if (disposed) return;

        const videoBuffer = mediaSource.addSourceBuffer(getMimeType(videoStream, "video"));
        const audioBuffer = mediaSource.addSourceBuffer(getMimeType(audioStream, "audio"));
        const videoStreamPump = streamToSourceBuffer(
          videoUrls,
          videoBuffer,
          videoElement,
          controller.signal,
        );
        const audioStreamPump = streamToSourceBuffer(
          audioUrls,
          audioBuffer,
          videoElement,
          controller.signal,
        );

        await Promise.all([videoStreamPump.started, audioStreamPump.started]);
        if (disposed) return;

        setIsLoading(false);
        videoElement.play().catch(() => {
          // 浏览器可能要求用户再次点击播放控件，不影响已加载的视频。
        });

        await Promise.all([videoStreamPump.completed, audioStreamPump.completed]);
        if (mediaSource.readyState === "open") mediaSource.endOfStream();
      } catch (loadError) {
        if (controller.signal.aborted || disposed) return;
        console.error("加载 DASH 视频失败:", loadError);
        setError(loadError instanceof Error ? loadError.message : "加载视频失败");
        setIsLoading(false);
      }
    };

    load();

    return () => {
      disposed = true;
      controller.abort();
      videoElement.pause();
      videoElement.removeAttribute("src");
      videoElement.load();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
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
              正在解析音频与视频流...
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
