import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Music,
  Pause,
  Play,
  Repeat2,
  Shuffle,
  Video,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";

interface DocumentPipPlayerProps {
  title: string;
  author: string;
  cover: string;
  isMusicMode: boolean;
  isPlaying: boolean;
  isLoading: boolean;
  error: string;
  isMuted: boolean;
  isLooping: boolean;
  isShuffleEnabled: boolean;
  currentTime: number;
  duration: number;
  hasPrevious: boolean;
  hasNext: boolean;
  videoHostRef: RefObject<HTMLDivElement | null>;
  onTogglePlayback: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onSeek: (time: number) => void;
  onToggleMute: () => void;
  onToggleLoop: () => void;
  onToggleShuffle?: () => void;
  onToggleMode: () => void;
  onClose: () => void;
}

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

const AUDIO_PIP_DESIGN_WIDTH = 820;
const AUDIO_PIP_DESIGN_HEIGHT = 140;
const VIDEO_PIP_DESIGN_WIDTH = 720;
const VIDEO_PIP_DESIGN_HEIGHT = 480;

export const DOCUMENT_PIP_STYLES = `
  :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  * { box-sizing: border-box; }
  html, body, #document-pip-root { width: 100%; height: 100%; margin: 0; overflow: hidden; }
  body { background: #f8fafc; color: #172033; }
  button, input { font: inherit; }
  .bh-pip { width: 100%; height: 100%; background: #f8fafc; }
  .bh-pip button { border: 0; cursor: pointer; }
  .bh-pip button:disabled { cursor: default; opacity: .3; }
  .bh-pip-audio-stage { position: relative; overflow: hidden; }
  .bh-pip-audio { position: absolute; top: 50%; left: 50%; display: grid; width: 820px; height: 140px; margin: -70px 0 0 -410px; grid-template-columns: 104px minmax(0, 1fr) auto; align-items: center; gap: 18px; padding: 18px 20px; transform-origin: center; background: #f8fafc; }
  .bh-pip-cover { width: 104px; height: 104px; border-radius: 22px; object-fit: cover; background: #e2e8f0; box-shadow: 0 10px 24px rgba(15, 23, 42, .18); }
  .bh-pip-cover-placeholder { display: grid; place-items: center; color: #64748b; }
  .bh-pip-meta { min-width: 0; }
  .bh-pip-title { overflow: hidden; color: #111827; font-size: 20px; font-weight: 800; line-height: 1.25; text-overflow: ellipsis; white-space: nowrap; }
  .bh-pip-author { margin-top: 5px; overflow: hidden; color: #64748b; font-size: 14px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .bh-pip-progress-row { display: grid; grid-template-columns: 44px minmax(100px, 1fr) 44px; align-items: center; gap: 10px; margin-top: 16px; color: #64748b; font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .bh-pip-range { width: 100%; height: 4px; cursor: pointer; accent-color: #6257e7; }
  .bh-pip-actions { display: flex; align-items: center; gap: 8px; }
  .bh-pip-icon { display: grid; width: 42px; height: 42px; place-items: center; border-radius: 14px; background: transparent; color: #172033; transition: background .15s, color .15s; }
  .bh-pip-icon:hover { background: #e8eaf5; color: #5548e6; }
  .bh-pip-play { width: 58px; height: 58px; border-radius: 50%; background: #6257e7; color: white; box-shadow: 0 8px 20px rgba(98, 87, 231, .35); }
  .bh-pip-play:hover { background: #5548e6; color: white; }
  .bh-pip-active { color: #6257e7; background: #eceafe; }
  .bh-pip-close { border: 1px solid #dbe1ea !important; }
  .bh-pip-video { position: relative; background: #050505; }
  .bh-pip-video-host { position: absolute; inset: 0; }
  .bh-pip-video-host video { width: 100%; height: 100%; object-fit: contain; }
  .bh-pip-video-ui { position: absolute; top: 50%; left: 50%; width: 720px; height: 480px; margin: -240px 0 0 -360px; transform-origin: center; pointer-events: none; }
  .bh-pip-video-ui button, .bh-pip-video-ui input { pointer-events: auto; }
  .bh-pip-video-top { position: absolute; inset: 0 0 auto; z-index: 2; display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 16px 18px 40px; color: white; background: linear-gradient(to bottom, rgba(0,0,0,.78), transparent); }
  .bh-pip-video-title { min-width: 0; overflow: hidden; font-size: 15px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
  .bh-pip-video-bottom { position: absolute; inset: auto 0 0; z-index: 2; padding: 44px 16px 14px; color: white; background: linear-gradient(to top, rgba(0,0,0,.88), transparent); }
  .bh-pip-video-progress { display: grid; grid-template-columns: 42px 1fr 42px; align-items: center; gap: 9px; margin-bottom: 8px; font-size: 12px; font-variant-numeric: tabular-nums; }
  .bh-pip-video-controls { display: flex; align-items: center; justify-content: center; gap: 8px; }
  .bh-pip-video .bh-pip-icon { color: white; }
  .bh-pip-video .bh-pip-icon:hover { background: rgba(255,255,255,.18); color: white; }
  .bh-pip-loading { position: absolute; inset: 0; z-index: 1; display: grid; place-items: center; color: white; background: rgba(0,0,0,.35); }
  .bh-pip-spin { animation: bh-pip-spin 1s linear infinite; }
  @keyframes bh-pip-spin { to { transform: rotate(360deg); } }
  @media (prefers-color-scheme: dark) {
    body, .bh-pip, .bh-pip-audio { background: #111318; color: #f8fafc; }
    .bh-pip-title { color: #f8fafc; }
    .bh-pip-author, .bh-pip-progress-row { color: #a8b0bf; }
    .bh-pip-icon { color: #f8fafc; }
    .bh-pip-icon:hover { background: #272a34; }
    .bh-pip-close { border-color: #343844 !important; }
  }
`;

export const DocumentPipPlayer = ({
  title,
  author,
  cover,
  isMusicMode,
  isPlaying,
  isLoading,
  error,
  isMuted,
  isLooping,
  isShuffleEnabled,
  currentTime,
  duration,
  hasPrevious,
  hasNext,
  videoHostRef,
  onTogglePlayback,
  onPrevious,
  onNext,
  onSeek,
  onToggleMute,
  onToggleLoop,
  onToggleShuffle,
  onToggleMode,
  onClose,
}: DocumentPipPlayerProps) => {
  const pipStageRef = useRef<HTMLElement>(null);
  const [pipScale, setPipScale] = useState(1);

  useLayoutEffect(() => {
    const stage = pipStageRef.current;
    const pipWindow = stage?.ownerDocument.defaultView;
    if (!stage || !pipWindow) return;

    const updateScale = () => {
      const designWidth = isMusicMode ? AUDIO_PIP_DESIGN_WIDTH : VIDEO_PIP_DESIGN_WIDTH;
      const designHeight = isMusicMode ? AUDIO_PIP_DESIGN_HEIGHT : VIDEO_PIP_DESIGN_HEIGHT;
      const widthScale = stage.clientWidth / designWidth;
      const heightScale = stage.clientHeight / designHeight;
      setPipScale(Math.max(0.01, Math.min(1, widthScale, heightScale)));
    };

    updateScale();
    const animationFrame = pipWindow.requestAnimationFrame(updateScale);
    const resizeObserver = new ResizeObserver(updateScale);
    resizeObserver.observe(stage);
    pipWindow.addEventListener("resize", updateScale);
    pipWindow.visualViewport?.addEventListener("resize", updateScale);
    return () => {
      pipWindow.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      pipWindow.removeEventListener("resize", updateScale);
      pipWindow.visualViewport?.removeEventListener("resize", updateScale);
    };
  }, [isMusicMode]);

  const navigationControls = (
    <>
      <button
        type="button"
        className="bh-pip-icon"
        onClick={onPrevious}
        disabled={!hasPrevious}
        title="上一条"
      >
        <ChevronLeft size={24} />
      </button>
      <button
        type="button"
        className="bh-pip-icon bh-pip-play"
        onClick={onTogglePlayback}
        disabled={isLoading || Boolean(error)}
        title={isPlaying ? "暂停" : "播放"}
      >
        {isPlaying ? <Pause size={28} /> : <Play size={28} fill="currentColor" />}
      </button>
      <button
        type="button"
        className="bh-pip-icon"
        onClick={onNext}
        disabled={!hasNext}
        title="下一条"
      >
        <ChevronRight size={24} />
      </button>
    </>
  );

  if (isMusicMode) {
    return (
      <main ref={pipStageRef} className="bh-pip bh-pip-audio-stage">
        <div className="bh-pip-audio" style={{ transform: `scale(${pipScale})` }}>
          {cover ? (
            <img className="bh-pip-cover" src={cover.replace("http:", "https:")} alt={title} />
          ) : (
            <div className="bh-pip-cover bh-pip-cover-placeholder">
              <Music size={44} />
            </div>
          )}
          <section className="bh-pip-meta">
            <div className="bh-pip-title" title={title}>
              {title}
            </div>
            <div className="bh-pip-author">{error || author || "Bilibili"}</div>
            <div className="bh-pip-progress-row">
              <span>{formatTime(currentTime)}</span>
              <input
                className="bh-pip-range"
                type="range"
                min="0"
                max={duration || 0}
                step="0.1"
                value={Math.min(currentTime, duration || 0)}
                onChange={(event) => onSeek(Number(event.target.value))}
                disabled={!duration || isLoading}
                aria-label="播放进度"
              />
              <span>{formatTime(duration)}</span>
            </div>
          </section>
          <section className="bh-pip-actions">
            {navigationControls}
            <button
              type="button"
              className="bh-pip-icon"
              onClick={onToggleMute}
              title={isMuted ? "取消静音" : "静音"}
            >
              {isMuted ? <VolumeX size={22} /> : <Volume2 size={22} />}
            </button>
            <button
              type="button"
              className={`bh-pip-icon ${isLooping ? "bh-pip-active" : ""}`}
              onClick={onToggleLoop}
              title={isLooping ? "关闭单条循环" : "单条循环"}
            >
              <Repeat2 size={22} />
            </button>
            <button
              type="button"
              className={`bh-pip-icon ${isShuffleEnabled ? "bh-pip-active" : ""}`}
              onClick={onToggleShuffle}
              disabled={!onToggleShuffle}
              title={isShuffleEnabled ? "关闭随机播放" : "随机播放"}
            >
              <Shuffle size={22} />
            </button>
            <button type="button" className="bh-pip-icon" onClick={onToggleMode} title="展开画面">
              <Video size={22} />
            </button>
            <button
              type="button"
              className="bh-pip-icon bh-pip-close"
              onClick={onClose}
              title="关闭画中画"
            >
              <X size={22} />
            </button>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main ref={pipStageRef} className="bh-pip bh-pip-video">
      <div ref={videoHostRef} className="bh-pip-video-host" />
      <div className="bh-pip-video-ui" style={{ transform: `scale(${pipScale})` }}>
        {(isLoading || error) && (
          <div className="bh-pip-loading">
            {error ? <span>{error}</span> : <Loader2 size={32} className="bh-pip-spin" />}
          </div>
        )}
        <header className="bh-pip-video-top">
          <div className="bh-pip-video-title" title={title}>
            {title}
          </div>
          <button type="button" className="bh-pip-icon" onClick={onClose} title="关闭画中画">
            <X size={21} />
          </button>
        </header>
        <footer className="bh-pip-video-bottom">
          <div className="bh-pip-video-progress">
            <span>{formatTime(currentTime)}</span>
            <input
              className="bh-pip-range"
              type="range"
              min="0"
              max={duration || 0}
              step="0.1"
              value={Math.min(currentTime, duration || 0)}
              onChange={(event) => onSeek(Number(event.target.value))}
              disabled={!duration || isLoading}
              aria-label="播放进度"
            />
            <span>{formatTime(duration)}</span>
          </div>
          <div className="bh-pip-video-controls">
            {navigationControls}
            <button
              type="button"
              className="bh-pip-icon"
              onClick={onToggleMute}
              title={isMuted ? "取消静音" : "静音"}
            >
              {isMuted ? <VolumeX size={22} /> : <Volume2 size={22} />}
            </button>
            <button
              type="button"
              className={`bh-pip-icon ${isLooping ? "bh-pip-active" : ""}`}
              onClick={onToggleLoop}
              title={isLooping ? "关闭单条循环" : "单条循环"}
            >
              <Repeat2 size={22} />
            </button>
            <button
              type="button"
              className={`bh-pip-icon ${isShuffleEnabled ? "bh-pip-active" : ""}`}
              onClick={onToggleShuffle}
              disabled={!onToggleShuffle}
              title={isShuffleEnabled ? "关闭随机播放" : "随机播放"}
            >
              <Shuffle size={22} />
            </button>
            <button type="button" className="bh-pip-icon" onClick={onToggleMode} title="音乐模式">
              <Music size={22} />
            </button>
          </div>
        </footer>
      </div>
    </main>
  );
};
