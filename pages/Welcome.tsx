import { useEffect, useState } from "react";
import { CloudDownload, Download, HardDrive, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { getStorageValue, setStorageValue } from "../utils/storage";
import {
  INITIAL_SETUP_COMPLETED,
  SYNC_PROGRESS_FAV,
  SYNC_PROGRESS_HISTORY,
} from "../utils/constants";

interface HistoryProgress {
  current: number;
  message: string;
}

interface FavoriteProgress {
  current: number;
  total?: number;
  message: string;
}

interface SyncResponse {
  success?: boolean;
  error?: string;
}

const Welcome = () => {
  const navigate = useNavigate();
  const [isStartingLocal, setIsStartingLocal] = useState(false);
  const [error, setError] = useState("");
  const [historyProgress, setHistoryProgress] = useState<HistoryProgress | null>(null);
  const [favProgress, setFavProgress] = useState<FavoriteProgress | null>(null);

  useEffect(() => {
    const loadProgress = async () => {
      setHistoryProgress(await getStorageValue(SYNC_PROGRESS_HISTORY, null));
      setFavProgress(await getStorageValue(SYNC_PROGRESS_FAV, null));
    };
    loadProgress();

    const handleStorageChange = (
      changes: Record<string, Browser.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== "local") return;
      if (changes[SYNC_PROGRESS_HISTORY]) {
        setHistoryProgress(changes[SYNC_PROGRESS_HISTORY].newValue as HistoryProgress | null);
      }
      if (changes[SYNC_PROGRESS_FAV]) {
        setFavProgress(changes[SYNC_PROGRESS_FAV].newValue as FavoriteProgress | null);
      }
    };

    browser.storage.onChanged.addListener(handleStorageChange);
    return () => browser.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  const startLocalSync = async () => {
    setIsStartingLocal(true);
    setError("");

    try {
      const [historyResult, favoritesResult] = await Promise.all([
        browser.runtime.sendMessage({ action: "syncHistory" }) as Promise<SyncResponse>,
        browser.runtime.sendMessage({ action: "syncFavorites" }) as Promise<SyncResponse>,
      ]);

      const errors = [historyResult, favoritesResult]
        .filter((result) => !result?.success)
        .map((result) => result?.error || "未知错误");
      if (errors.length > 0) throw new Error(errors.join("；"));

      await setStorageValue(INITIAL_SETUP_COMPLETED, true);
      window.location.replace(browser.runtime.getURL("/my-history.html"));
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "初始化失败，请稍后重试");
    } finally {
      setIsStartingLocal(false);
    }
  };

  const favoritePercent =
    favProgress?.total && favProgress.total > 0
      ? Math.min(100, Math.round((favProgress.current / favProgress.total) * 100))
      : 0;

  return (
    <main className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-pink-50 px-5 py-10 dark:from-neutral-950 dark:via-neutral-950 dark:to-slate-950">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-4xl flex-col justify-center">
        <div className="mb-9 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#00a1d6] text-white shadow-lg shadow-sky-200 dark:shadow-none">
            <HardDrive className="h-8 w-8" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-4xl">
            欢迎使用 Bilibili 无限历史记录
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-gray-500 dark:text-neutral-400 sm:text-base">
            先选择数据来源。扩展会等你确认后再开始请求，重新安装时不会自动全量拉取 B 站数据。
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <button
            type="button"
            onClick={startLocalSync}
            disabled={isStartingLocal}
            className="group rounded-2xl border border-sky-200 bg-white p-6 text-left shadow-sm transition hover:-translate-y-1 hover:border-sky-400 hover:shadow-xl disabled:cursor-wait disabled:opacity-70 dark:border-sky-500/20 dark:bg-neutral-900 dark:hover:border-sky-500/50"
          >
            <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-sky-100 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400">
              <Download className={`h-6 w-6 ${isStartingLocal ? "animate-bounce" : ""}`} />
            </span>
            <span className="block text-xl font-bold text-gray-900 dark:text-white">
              {isStartingLocal ? "正在拉取本地数据..." : "从 B 站开始"}
            </span>
            <span className="mt-2 block text-sm leading-6 text-gray-500 dark:text-neutral-400">
              首次全量拉取观看历史和收藏夹并保存到本机，之后只进行增量同步。
            </span>
            <span className="mt-5 inline-flex items-center text-sm font-semibold text-sky-600 dark:text-sky-400">
              适合首次使用
              <span className="ml-1 transition-transform group-hover:translate-x-1">→</span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => navigate("/webdav-sync?onboarding=1")}
            disabled={isStartingLocal}
            className="group rounded-2xl border border-pink-200 bg-white p-6 text-left shadow-sm transition hover:-translate-y-1 hover:border-pink-400 hover:shadow-xl disabled:opacity-70 dark:border-pink-500/20 dark:bg-neutral-900 dark:hover:border-pink-500/50"
          >
            <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-pink-100 text-pink-600 dark:bg-pink-500/10 dark:text-pink-400">
              <CloudDownload className="h-6 w-6" />
            </span>
            <span className="block text-xl font-bold text-gray-900 dark:text-white">
              从 WebDAV 恢复
            </span>
            <span className="mt-2 block text-sm leading-6 text-gray-500 dark:text-neutral-400">
              先配置你的 WebDAV 服务，再下载云端历史、收藏夹、音乐和偏好设置。
            </span>
            <span className="mt-5 inline-flex items-center text-sm font-semibold text-pink-600 dark:text-pink-400">
              适合已有云端备份
              <span className="ml-1 transition-transform group-hover:translate-x-1">→</span>
            </span>
          </button>
        </div>

        {isStartingLocal && (
          <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-semibold text-gray-700 dark:text-neutral-200">
                    历史记录
                  </span>
                  <span className="text-sky-600 dark:text-sky-400">
                    {historyProgress?.current || 0} 条
                  </span>
                </div>
                <p className="truncate text-xs text-gray-500 dark:text-neutral-400">
                  {historyProgress?.message || "正在准备..."}
                </p>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-semibold text-gray-700 dark:text-neutral-200">收藏夹</span>
                  <span className="text-pink-600 dark:text-pink-400">
                    {favProgress?.total
                      ? `${favProgress.current} / ${favProgress.total}`
                      : `${favProgress?.current || 0} 条`}
                  </span>
                </div>
                {favoritePercent > 0 && (
                  <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-pink-100 dark:bg-pink-500/10">
                    <div
                      className="h-full rounded-full bg-pink-500 transition-all"
                      style={{ width: `${favoritePercent}%` }}
                    />
                  </div>
                )}
                <p className="truncate text-xs text-gray-500 dark:text-neutral-400">
                  {favProgress?.message || "正在准备..."}
                </p>
              </div>
            </div>
          </section>
        )}

        {error && (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
            初始化失败：{error}
          </div>
        )}

        <div className="mt-7 flex items-center justify-center gap-2 text-xs text-gray-400 dark:text-neutral-500">
          <ShieldCheck className="h-4 w-4" />
          数据仅保存在本机或你配置的 WebDAV 服务中
        </div>
      </div>
    </main>
  );
};

export default Welcome;
