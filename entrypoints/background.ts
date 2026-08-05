import {
  HAS_FULL_SYNC,
  HAS_FULL_FAV_SYNC,
  SYNC_INTERVAL,
  SYNC_TIME_REMAIN,
  IS_SYNC_DELETE_FROM_BILIBILI,
  IS_SYNCING,
  IS_SYNCING_FAV,
  FAV_AUTO_SYNC_ENABLED,
  FAV_SYNC_INTERVAL,
  FAV_SYNC_TIME_REMAIN,
  SYNC_PROGRESS_HISTORY,
  SYNC_PROGRESS_FAV,
  SYNC_PROGRESS_COLLECTIONS,
  HIDDEN_MENUS,
  HISTORY_LAST_SYNC,
  WEBDAV_CONFIG,
  WEBDAV_LAST_SYNC,
  WEBDAV_AUTO_SYNC_ENABLED,
  WEBDAV_AUTO_SYNC_INTERVAL,
  INITIAL_SETUP_COMPLETED,
  WEBDAV_SYNC_ITEMS,
  DEFAULT_WEBDAV_SYNC_ITEMS,
  WebDavSyncItems,
  WebDavSyncKey,
  LOCAL_HISTORY_BACKUP_ALARM,
} from "../utils/constants";
import {
  openDB,
  getItem,
  deleteHistoryItem,
  saveFavFolders,
  saveFavResources,
  getFavResources,
  deleteFavResources,
  deleteFavFolder,
  deleteFavResource,
  moveFavResource,  replaceFavFolders,
  getAllHistory,
  getAllLikedMusic,
  getAllFavFolders,
  getAllFavResources,
  getAllSubscribedCollections,
  getAllSubscribedCollectionResources,
  smartMergeHistory,
  smartMergeLikedMusic,
  smartMergeFavResources,
  importFavFolders,
  importSubscribedCollections,
  smartMergeSubscribedCollectionResources,
  replaceSubscribedCollections,
  replaceSubscribedCollectionResources,
  deleteSubscribedCollection,
} from "../utils/db";
import { getStorageValue, setStorageValue } from "../utils/storage";
import { WebDavConfig, ensureDirectory, uploadFile, downloadFile } from "../utils/webdav";
import { recordStorageWarning } from "../utils/storageHealth";
import {
  FavoriteFolder,
  RefreshFavoriteFoldersResponse,
  SubscribedCollection,
  SubscribedCollectionResource,
  SyncFavoriteFolderRequest,
  SyncFavoriteFolderResponse,
  SyncHistoryRequest,
  SyncHistoryResponse,
  LocalHistoryBackupRequest,
  LocalHistoryBackupResult,
} from "../utils/types";
import { isLocalHistoryBackupDue, runLocalHistoryBackup } from "../utils/localHistoryBackup";

export default defineBackground(() => {
  let localHistoryBackupPromise: Promise<LocalHistoryBackupResult> | null = null;

  const ensureLocalHistoryBackupAlarm = async (): Promise<void> => {
    const alarm = await browser.alarms.get(LOCAL_HISTORY_BACKUP_ALARM);
    if (!alarm || alarm.periodInMinutes !== 1) {
      await browser.alarms.create(LOCAL_HISTORY_BACKUP_ALARM, {
        periodInMinutes: 1,
      });
    }
  };

  const runLocalHistoryBackupOnce = (allowEmpty = false): Promise<LocalHistoryBackupResult> => {
    if (localHistoryBackupPromise) return localHistoryBackupPromise;

    localHistoryBackupPromise = runLocalHistoryBackup(allowEmpty).finally(() => {
      localHistoryBackupPromise = null;
    });
    return localHistoryBackupPromise;
  };

  void ensureLocalHistoryBackupAlarm().catch((error) => {
    console.error("初始化历史记录本地备份定时任务失败:", error);
  });

  const actionApi = browser.action ?? browser.browserAction;
  actionApi.onClicked.addListener(() => {
    void browser.tabs.create({
      url: browser.runtime.getURL("/my-history.html"),
    });
  });

  const fetchBilibiliApi = async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (!headers.has("Accept")) headers.set("Accept", "application/json, text/plain, */*");

    const cookies = await browser.cookies.getAll({ domain: "bilibili.com" });
    if (cookies.length > 0) {
      headers.set("Cookie", cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "));
    }

    return fetch(url, {
      ...init,
      // 扩展页跨域请求默认不会附带站点 Cookie。显式携带完整登录态可避免
      // 仅靠 SESSDATA 时被风控接口拒绝（例如 HTTP 412）。
      credentials: "include",
      cache: "no-store",
      headers,
    });
  };

  // 初始化定时任务
  browser.runtime.onInstalled.addListener(async (details) => {
    // 全新安装必须先由用户选择初始化方式，避免安装完成后立即大量请求 B 站接口。
    if (details.reason === "install") {
      await setStorageValue(INITIAL_SETUP_COMPLETED, false);
    }

    // 设置每分钟同步一次
    browser.alarms.create("syncHistory", {
      periodInMinutes: 1,
    });
    // 设置每分钟检查一次收藏夹同步
    browser.alarms.create("syncFavorites", {
      periodInMinutes: 1,
    });
    // 设置每分钟检查一次 WebDAV 自动同步
    browser.alarms.create("syncWebDav", {
      periodInMinutes: 1,
    });

    // 只在首次安装时打开开始页面，等待用户主动选择数据来源
    if (details.reason === "install") {
      const url = browser.runtime.getURL("/my-history.html#/welcome");
      await browser.tabs.create({ url });
    }
  });

  const intervalSync = async (syncInterval: number = 1) => {
    try {
      // 检查是否正在同步
      const isSyncing = await getStorageValue(IS_SYNCING);
      if (isSyncing) {
        console.log("同步正在进行中，跳过本次定时同步");
        return;
      }

      // 设置同步状态为进行中
      await setStorageValue(IS_SYNCING, true);
      await setStorageValue(SYNC_PROGRESS_HISTORY, { current: 0, message: "开始定时同步..." });

      // 执行增量同步
      await syncHistory(false);
    } catch (error) {
      console.error("定时同步失败:", error);
    } finally {
      // 无论成功还是失败，都重置同步状态
      await setStorageValue(IS_SYNCING, false);
      await setStorageValue(SYNC_PROGRESS_HISTORY, { current: 0, message: "同步结束" });
      // 重置当前同步剩余时间
      await setStorageValue(SYNC_TIME_REMAIN, syncInterval);
    }
  };

  const intervalFavSync = async (syncInterval: number) => {
    let success = true;
    try {
      const isSyncing = await getStorageValue(IS_SYNCING_FAV);
      if (isSyncing) {
        console.log("收藏夹同步进行中，跳过本次");
        return;
      }

      await setStorageValue(IS_SYNCING_FAV, true);
      await syncFavorites(false);
    } catch (error) {
      console.error("定时收藏夹同步失败", error);
      success = false;
    } finally {
      await setStorageValue(IS_SYNCING_FAV, false);
      if (success) {
        await setStorageValue(FAV_SYNC_TIME_REMAIN, syncInterval);
      } else {
        console.log("收藏夹增量同步失败，1分钟后重试...");
        await setStorageValue(FAV_SYNC_TIME_REMAIN, 1);
      }
    }
  };

  // 监听定时任务
  browser.alarms.onAlarm.addListener(async (alarm) => {
    const initialSetupCompleted = await getStorageValue(INITIAL_SETUP_COMPLETED, true);
    if (!initialSetupCompleted) {
      console.log("首次设置尚未完成，跳过自动同步");
      return;
    }

    if (alarm.name === "syncHistory") {
      // 获取同步间隔
      const syncInterval = await getStorageValue(SYNC_INTERVAL, 1);
      // 根据最近一次成功同步的时间判断是否需要同步
      const lastSyncTime = await getStorageValue<number>(HISTORY_LAST_SYNC, 0);
      const elapsed = Date.now() - lastSyncTime;
      const intervalMs = syncInterval * 60 * 1000;

      if (elapsed <= intervalMs) {
        const remainingMinutes = Math.ceil((intervalMs - elapsed) / 60000);
        console.log(`还需${remainingMinutes}分钟进行历史记录同步，暂时跳过`);
        return;
      }
      // 使用提取的函数处理定时任务
      intervalSync(syncInterval);
    } else if (alarm.name === "syncFavorites") {
      // 检查是否隐藏了收藏夹功能
      const hiddenMenus = await getStorageValue<string[]>(HIDDEN_MENUS, []);
      if (hiddenMenus.includes("收藏夹")) {
        console.log("收藏夹功能已禁用，跳过同步");
        return;
      }

      // skip when auto favorites sync switch is off (default off)
      const favAutoSyncEnabled = await getStorageValue(FAV_AUTO_SYNC_ENABLED, false);
      if (!favAutoSyncEnabled) {
        console.log("自动同步收藏夹开关未开启，跳过本次收藏夹同步");
        return;
      }

      // 默认改成15分钟同步一次
      const syncInterval = await getStorageValue(FAV_SYNC_INTERVAL, 15);
      const syncRemain = await getStorageValue(FAV_SYNC_TIME_REMAIN, syncInterval);
      const currentSyncRemain = syncRemain - 1;

      if (currentSyncRemain > 0) {
        console.log(`还需${currentSyncRemain}分钟进行收藏夹同步，暂时跳过`);
        await setStorageValue(FAV_SYNC_TIME_REMAIN, currentSyncRemain);
        return;
      }
      intervalFavSync(syncInterval);
    } else if (alarm.name === "syncWebDav") {
      // WebDAV 自动同步：基于上次同步时间判断
      const enabled = await getStorageValue(WEBDAV_AUTO_SYNC_ENABLED, false);
      if (!enabled) return;

      const syncInterval = await getStorageValue(WEBDAV_AUTO_SYNC_INTERVAL, 30);
      const lastSyncTime = await getStorageValue<number>(WEBDAV_LAST_SYNC, 0);
      const elapsed = Date.now() - lastSyncTime;
      const intervalMs = syncInterval * 60 * 1000;

      if (elapsed < intervalMs) {
        console.log(
          `WebDAV 自动同步：距上次同步仅 ${Math.round(elapsed / 60000)} 分钟，需等待 ${syncInterval} 分钟`,
        );
        return;
      }

      // 距离上次同步已超过设定间隔，执行备份
      autoSyncWebDav();
    }
  });

  // 处理同步历史记录的消息
  const handleSyncHistory = async (message: any, sendResponse: (response: any) => void) => {
    try {
      // 检查是否正在同步
      const isSyncing = await getStorageValue(IS_SYNCING);
      if (isSyncing) {
        console.log("同步正在进行中，请稍后再试");
        sendResponse({
          success: false,
          error: "同步正在进行中，请稍后再试",
        });
        return;
      }

      // 设置同步状态为进行中
      await setStorageValue(IS_SYNCING, true);
      await setStorageValue(SYNC_PROGRESS_HISTORY, { current: 0, message: "准备开始同步..." });

      // 获取前端传递的isFullSync参数，如果没有则根据历史记录判断
      const forceFullSync = message.isFullSync || false;
      let syncResult = "";

      if (forceFullSync) {
        // 如果前端强制要求全量同步
        await syncHistory(true);
        await setStorageValue(HAS_FULL_SYNC, true);
        syncResult = "全量同步成功";
        sendResponse({ success: true, message: syncResult });
      } else {
        // 之前有没有全量同步过
        const hasFullSync = await getStorageValue(HAS_FULL_SYNC, false);
        if (hasFullSync) {
          await syncHistory(false);
          syncResult = "增量同步成功";
          sendResponse({ success: true, message: syncResult });
        } else {
          // 如果没有同步记录，执行全量同步
          await syncHistory(true);
          await setStorageValue(HAS_FULL_SYNC, true);
          syncResult = "全量同步初始化成功";
          sendResponse({ success: true, message: syncResult });
        }
      }
    } catch (error) {
      console.error("同步失败:", error);
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : "未知错误",
      });
    } finally {
      // 无论成功还是失败，都重置同步状态
      await setStorageValue(IS_SYNCING, false);
      await setStorageValue(SYNC_PROGRESS_HISTORY, { current: 0, message: "同步完成" });
    }
  };

  const handleSyncFavorites = async (message: any, sendResponse: (response: any) => void) => {
    try {
      if (message.forceFull) {
        await syncAllFavoritesForBackup();
        sendResponse({ success: true, message: "收藏夹全量同步成功" });
        return;
      }

      const isSyncing = await getStorageValue(IS_SYNCING_FAV);
      if (isSyncing) {
        sendResponse({ success: false, error: "收藏夹同步正在进行中" });
        return;
      }

      await setStorageValue(IS_SYNCING_FAV, true);
      const hasFullFavSync = await getStorageValue(HAS_FULL_FAV_SYNC, false);
      if (!hasFullFavSync) {
        await syncFavorites(true);
        await setStorageValue(HAS_FULL_FAV_SYNC, true);
      } else {
        await syncFavorites(false);
      }
      sendResponse({ success: true, message: "收藏夹同步成功" });
    } catch (error) {
      console.error("同步收藏夹失败:", error);
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : "未知错误",
      });
    } finally {
      await setStorageValue(IS_SYNCING_FAV, false);
    }
  };

  const handleSyncSubscribedCollections = async (sendResponse: (response: any) => void) => {
    try {
      await syncSubscribedCollections();
      sendResponse({ success: true, message: "订阅合集同步成功" });
    } catch (error) {
      console.error("同步订阅合集失败:", error);
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : "未知错误",
      });
    }
  };

  const handleSyncSubscribedCollectionResources = async (
    message: any,
    sendResponse: (response: any) => void,
  ) => {
    const collectionId = Number(message.collectionId);
    if (!Number.isFinite(collectionId)) {
      sendResponse({ success: false, error: "合集信息不完整" });
      return;
    }

    try {
      await syncSubscribedCollectionResources(collectionId);
      sendResponse({ success: true, message: "合集内容同步成功" });
    } catch (error) {
      console.error("同步合集内容失败:", error);
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : "未知错误",
      });
    }
  };

  const handleSyncAllSubscribedCollectionResources = async (
    sendResponse: (response: any) => void,
  ) => {
    try {
      await syncAllSubscribedCollectionResources();
      sendResponse({ success: true, message: "全部合集内容同步成功" });
    } catch (error) {
      console.error("同步全部合集内容失败:", error);
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : "未知错误",
      });
    }
  };

  // 处理删除历史记录的消息
  const handleDeleteHistoryItem = async (message: any, sendResponse: (response: any) => void) => {
    try {
      const syncDeleteFromBilibili = await getStorageValue(IS_SYNC_DELETE_FROM_BILIBILI, true);
      if (!syncDeleteFromBilibili) {
        sendResponse({ success: true, message: "同步删除未开启" });
        return;
      }
      await deleteHistoryItem(message.id);
      sendResponse({ success: true, message: "历史记录删除成功" });
    } catch (error) {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : "删除失败",
      });
    }
  };

  const postBilibiliForm = async (path: string, values: Record<string, string | number>) => {
    const cookies = await browser.cookies.getAll({ domain: "bilibili.com" });
    const sessdata = cookies.find((cookie) => cookie.name === "SESSDATA")?.value;
    const csrf = cookies.find((cookie) => cookie.name === "bili_jct")?.value;
    if (!sessdata || !csrf) throw new Error("请先登录 B 站后再操作");

    const body = new URLSearchParams({
      ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)])),
      csrf,
    });
    const response = await fetchBilibiliApi(`https://api.bilibili.com${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: `SESSDATA=${sessdata}; bili_jct=${csrf}`,
      },
      body,
    });
    if (!response.ok) throw new Error(`请求失败（${response.status}）`);

    const data = await response.json();
    if (data.code !== 0) throw new Error(data.message || "B 站未完成此操作");
  };

  const handleEditFavFolder = async (message: any, sendResponse: (response: any) => void) => {
    try {
      const folderId = Number(message.folderId);
      const title = String(message.title || "").trim();
      if (!Number.isFinite(folderId) || !title) throw new Error("收藏夹名称不能为空");
      await postBilibiliForm("/x/v3/fav/folder/edit", { media_id: folderId, title });
      sendResponse({ success: true });
    } catch (error) {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : "修改收藏夹失败",
      });
    }
  };

  const handleDeleteFavFolder = async (message: any, sendResponse: (response: any) => void) => {
    try {
      const folderId = Number(message.folderId);
      if (!Number.isFinite(folderId)) throw new Error("收藏夹信息不完整");
      await postBilibiliForm("/x/v3/fav/folder/del", { media_ids: folderId });
      await deleteFavFolder(folderId);
      sendResponse({ success: true });
    } catch (error) {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : "删除收藏夹失败",
      });
    }
  };

  const handleDeleteFavResource = async (message: any, sendResponse: (response: any) => void) => {
    try {
      const folderId = Number(message.folderId);
      const resourceId = Number(message.resourceId);
      const resourceType = Number(message.resourceType);
      if (
        !Number.isFinite(folderId) ||
        !Number.isFinite(resourceId) ||
        !Number.isFinite(resourceType)
      ) {
        throw new Error("收藏内容信息不完整");
      }
      await postBilibiliForm("/x/v3/fav/resource/batch-del", {
        media_id: folderId,
        resources: `${resourceId}:${resourceType}`,
        platform: "web",
      });
      await deleteFavResource(folderId, resourceId);
      sendResponse({ success: true });
    } catch (error) {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : "移出收藏夹失败",
      });
    }
  };

  const handleMoveFavResource = async (message: any, sendResponse: (response: any) => void) => {
    try {
      const sourceFolderId = Number(message.sourceFolderId);
      const targetFolderId = Number(message.targetFolderId);
      const resourceId = Number(message.resourceId);
      const resourceType = Number(message.resourceType);
      if (
        !Number.isFinite(sourceFolderId) ||
        !Number.isFinite(targetFolderId) ||
        sourceFolderId === targetFolderId ||
        !Number.isFinite(resourceId) ||
        !Number.isFinite(resourceType)
      ) {
        throw new Error("收藏内容或目标收藏夹信息不完整");
      }

      const sessdata = await getBilibiliSession();
      const mid = await getCurrentBilibiliMid(sessdata);
      await postBilibiliForm("/x/v3/fav/resource/move", {
        src_media_id: sourceFolderId,
        tar_media_id: targetFolderId,
        mid,
        resources: `${resourceId}:${resourceType}`,
        platform: "web",
      });
      await moveFavResource(sourceFolderId, targetFolderId, resourceId);
      sendResponse({ success: true });
    } catch (error) {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : "移动收藏内容失败",
      });
    }
  };

  const handleUnsubscribeCollection = async (
    message: any,
    sendResponse: (response: any) => void,
  ) => {
    try {
      const collectionId = Number(message.collectionId);
      if (!Number.isFinite(collectionId)) throw new Error("合集信息不完整");
      await postBilibiliForm("/x/v3/fav/folder/del", { media_ids: collectionId });
      await deleteSubscribedCollection(collectionId);
      sendResponse({ success: true });
    } catch (error) {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : "取消订阅失败",
      });
    }
  };

  const handleSyncFavoriteFolder = async (
    message: SyncFavoriteFolderRequest,
    sendResponse: (response: SyncFavoriteFolderResponse) => void,
  ) => {
    const folderId = Number(message.folderId);
    if (!Number.isSafeInteger(folderId) || folderId <= 0) {
      sendResponse({ success: false, error: "收藏夹信息不完整" });
      return;
    }
    if (typeof message.isFullSync !== "boolean") {
      sendResponse({ success: false, error: "同步方式不完整" });
      return;
    }

    let response: SyncFavoriteFolderResponse;
    try {
      const folder = await syncFavoriteFolderById(folderId, message.isFullSync);
      const mode = message.isFullSync ? "full" : "incremental";
      response = {
        success: true,
        message: `「${folder.title}」${message.isFullSync ? "全量" : "增量"}同步成功`,
        folderId,
        mode,
      };
    } catch (error) {
      console.error("同步单个收藏夹失败:", error);
      response = {
        success: false,
        error: error instanceof Error ? error.message : "未知错误",
      };
    }

    sendResponse(response);
  };

  const handleRefreshFavoriteFolders = async (
    sendResponse: (response: RefreshFavoriteFoldersResponse) => void,
  ) => {
    try {
      const { folders } = await getFavoriteFoldersFromBilibili();
      await replaceFavFolders(folders);
      sendResponse({ success: true, folderCount: folders.length });
    } catch (error) {
      console.error("刷新收藏夹目录失败:", error);
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : "未知错误",
      });
    }
  };

  const handleRunLocalHistoryBackup = async (
    message: LocalHistoryBackupRequest,
    sendResponse: (response: LocalHistoryBackupResult) => void,
  ) => {
    try {
      sendResponse(await runLocalHistoryBackupOnce(Boolean(message.allowEmpty)));
    } catch (error) {
      sendResponse({
        success: false,
        errorCode: "WRITE_FAILED",
        error: error instanceof Error ? error.message : "本地备份失败",
      });
    }
  };
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "syncHistory") {
      handleSyncHistory(message, sendResponse);
      return true; // 保持消息通道开放
    } else if (message.action === "getCookies") {
      browser.cookies.getAll({ domain: "bilibili.com" }).then((cookies) => {
        sendResponse({ success: true, cookies });
      });
      return true;
    } else if (message.action === "deleteHistoryItem") {
      handleDeleteHistoryItem(message, sendResponse);
      return true;
    } else if (message.action === "editFavFolder") {
      handleEditFavFolder(message, sendResponse);
      return true;
    } else if (message.action === "deleteFavFolder") {
      handleDeleteFavFolder(message, sendResponse);
      return true;
    } else if (message.action === "deleteFavResource") {
      handleDeleteFavResource(message, sendResponse);
      return true;
    } else if (message.action === "moveFavResource") {
      handleMoveFavResource(message, sendResponse);
      return true;
    } else if (message.action === "unsubscribeCollection") {
      handleUnsubscribeCollection(message, sendResponse);
      return true; // 保持消息通道开放
    } else if (message.action === "syncFavorites") {
      handleSyncFavorites(message, sendResponse);
      return true;
    } else if (message.action === "syncFavoriteFolder") {
      handleSyncFavoriteFolder(message as SyncFavoriteFolderRequest, sendResponse);
      return true;
    } else if (message.action === "refreshFavoriteFolders") {
      handleRefreshFavoriteFolders(sendResponse);
      return true;
    } else if (message.action === "syncSubscribedCollections") {
      handleSyncSubscribedCollections(sendResponse);
      return true;
    } else if (message.action === "syncSubscribedCollectionResources") {
      handleSyncSubscribedCollectionResources(message, sendResponse);
      return true;
    } else if (message.action === "syncAllSubscribedCollectionResources") {
      handleSyncAllSubscribedCollectionResources(sendResponse);
    } else if (message.action === "runLocalHistoryBackup") {
      handleRunLocalHistoryBackup(message as LocalHistoryBackupRequest, sendResponse);
      return true;
    }
  });

  // 全量同步历史记录
  async function syncHistory(isFullSync = false): Promise<boolean> {
    try {
      // 获取 B 站 cookie
      const cookies = await browser.cookies.getAll({
        domain: "bilibili.com",
      });
      const SESSDATA = cookies.find((cookie) => cookie.name === "SESSDATA")?.value;

      if (!SESSDATA) {
        throw new Error("未找到 B 站登录信息，请先登录 B 站");
      }

      let hasMore = true;
      let max = 0;
      let view_at = 0;
      const type = "all";
      const ps = 30;
      let totalSynced = 0;      console.log(`${isFullSync ? "全量" : "增量"}同步开始`);

      // 循环获取所有历史记录
      while (hasMore) {
        // 获取历史记录
        const response = await fetchBilibiliApi(
          `https://api.bilibili.com/x/web-interface/history/cursor?max=${max}&view_at=${view_at}&type=${type}&ps=${ps}`,
          {
            headers: {
              Cookie: `SESSDATA=${SESSDATA}`,
            },
          },
        );

        if (!response.ok) {
          throw new Error("获取历史记录失败");
        }

        const { data, code, message } = await response.json();

        if (code !== 0) {
          throw new Error(message || "获取历史记录失败");
        }

        const { cursor, list } = data;
        // 更新分页参数
        hasMore = list.length > 0;
        max = cursor.max;
        view_at = cursor.view_at;

        if (list.length > 0) {
          // 为每批数据创建新的事务
          const db = await openDB();
          const tx = db.transaction("history", "readwrite");
          const store = tx.objectStore("history");
          // 取出list中的第一条和最后一条
          if (!isFullSync) {
            const firstItem = list[0];
            const lastItem = list[list.length - 1];
            // 如果firstItem的bvid和lastItem的bvid在indexedDB中存在，则不进行同步
            const firstItemExists = await getItem(store, firstItem.history.oid);
            const lastItemExists = await getItem(store, lastItem.history.oid);
            if (firstItemExists && lastItemExists) {
              hasMore = false;
            }
          }

          // 批量存储历史记录
          for (const item of list) {
            // put是异步的
            store.put({
              id: item.history.oid,
              business: item.history.business,
              bvid: item.history.bvid,
              cid: item.history.cid,
              title: item.title,
              tag_name: item.tag_name,
              cover: item.cover || (item.covers && item.covers[0]),
              view_at: item.view_at,
              uri: item.uri,
              author_name: item.author_name || "",
              author_mid: item.author_mid || "",
              progress: item.progress,
              duration: item.duration,
              is_fav: item.is_fav === 1, // 保存是否收藏字段
              timestamp: Date.now(),
              uploaded: false,
            });
          }

          totalSynced += data.data.list.length;
          // 更新同步进度
          await setStorageValue(SYNC_PROGRESS_HISTORY, {
            current: totalSynced,
            message: `正在同步... 已获取 ${totalSynced} 条`,
          });
          console.log(`同步了${data.data.list.length}条历史记录，总计：${totalSynced}`);

          // 等待事务完成
          await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => {
              void recordStorageWarning(tx.error, "sync-history-transaction");
              reject(tx.error);
            };
            tx.onabort = () => {
              void recordStorageWarning(tx.error, "sync-history-transaction-abort");
              reject(tx.error);
            };
          });

          // 添加延时，避免请求过于频繁
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
      console.log(`${isFullSync ? "全量" : "增量"}同步结束`);

      if (isFullSync) {
        await setStorageValue(HAS_FULL_SYNC, true);
      }

      // 更新最后同步时间
      await setStorageValue(HISTORY_LAST_SYNC, Date.now());

      return true;
    } catch (error) {
      console.error("同步历史记录失败:", error);
      await setStorageValue(SYNC_PROGRESS_HISTORY, {
        current: 0,
        message: `同步失败: ${error instanceof Error ? error.message : "未知错误"}`,
      });
      throw error;
    }
  }

  async function syncAllFavoritesForBackup(): Promise<void> {
    const isSyncing = await getStorageValue(IS_SYNCING_FAV);
    if (isSyncing) throw new Error("收藏夹同步正在进行中");

    await setStorageValue(IS_SYNCING_FAV, true);
    try {
      await syncFavorites(true);
      await setStorageValue(HAS_FULL_FAV_SYNC, true);
    } finally {
      await setStorageValue(IS_SYNCING_FAV, false);
    }
  }

  async function getBilibiliSession(): Promise<string> {
    const cookies = await browser.cookies.getAll({ domain: "bilibili.com" });
    const sessdata = cookies.find((cookie) => cookie.name === "SESSDATA")?.value;
    if (!sessdata) throw new Error("未找到 B 站登录信息，请先登录 B 站");
    return sessdata;
  }

  async function getCurrentBilibiliMid(sessdata: string): Promise<number> {
    const navRes = await fetchBilibiliApi("https://api.bilibili.com/x/web-interface/nav", {
      headers: { Cookie: `SESSDATA=${sessdata}` },
    });
    if (!navRes.ok) throw new Error("获取用户信息失败");

    const navData = await navRes.json();
    if (navData.code !== 0 || !navData.data?.mid)
      throw new Error(navData.message || "获取用户信息失败");
    return navData.data.mid;
  }


  async function syncAllSubscribedCollectionResources(): Promise<void> {
    await syncSubscribedCollections();
    const collections = await getAllSubscribedCollections();
    const totalItems = collections.reduce((total, collection) => total + collection.media_count, 0);
    let currentSynced = 0;

    await setStorageValue(SYNC_PROGRESS_COLLECTIONS, {
      current: currentSynced,
      total: totalItems,
      message: "开始同步订阅合集...",
    });

    try {
      for (const collection of collections) {
        await setStorageValue(SYNC_PROGRESS_COLLECTIONS, {
          current: currentSynced,
          total: totalItems,
          message: `正在同步: ${collection.title}`,
        });
        await syncSubscribedCollectionResources(collection.id);
        currentSynced += collection.media_count;
        await setStorageValue(SYNC_PROGRESS_COLLECTIONS, {
          current: currentSynced,
          total: totalItems,
          message: `正在同步: ${collection.title}`,
        });
      }

      await setStorageValue(SYNC_PROGRESS_COLLECTIONS, {
        current: currentSynced,
        total: totalItems,
        message: "订阅合集同步完成",
      });
    } catch (error) {
      await setStorageValue(SYNC_PROGRESS_COLLECTIONS, {
        current: currentSynced,
        total: totalItems,
        message: `同步失败: ${error instanceof Error ? error.message : "未知错误"}`,
      });
      throw error;
    }
  }

  interface FavoriteFolderPage {
    medias: any[];
    hasMore: boolean;
  }

  async function getFavoriteFoldersFromBilibili(): Promise<{
    sessdata: string;
    folders: FavoriteFolder[];
  }> {
    const sessdata = await getBilibiliSession();

    const navRes = await fetch("https://api.bilibili.com/x/web-interface/nav", {
      headers: { Cookie: `SESSDATA=${sessdata}` },
    });
    if (!navRes.ok) throw new Error("获取用户信息失败");

    const navData = await navRes.json();
    if (navData.code !== 0) throw new Error(navData.message || "获取用户信息失败");

    const mid = Number(navData.data?.mid);
    if (!Number.isSafeInteger(mid) || mid <= 0) throw new Error("获取用户信息失败");

    const folderRes = await fetch(
      `https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${mid}`,
      { headers: { Cookie: `SESSDATA=${sessdata}` } },
    );
    if (!folderRes.ok) throw new Error("获取收藏夹失败");

    const folderData = await folderRes.json();
    if (folderData.code !== 0) throw new Error(folderData.message || "获取收藏夹失败");

    if (!folderData.data || !("list" in folderData.data)) {
      throw new Error("收藏夹数据格式异常");
    }

    const onlineFolders = folderData.data.list;
    if (onlineFolders !== null && !Array.isArray(onlineFolders)) {
      throw new Error("收藏夹数据格式异常");
    }

    const folders = (onlineFolders || []).map(
      (folder: FavoriteFolder, index: number): FavoriteFolder => ({
        ...folder,
        id: Number(folder.id),
        index,
      }),
    );

    return { sessdata, folders };
  }

  async function fetchFavoriteFolderPage(
    folder: FavoriteFolder,
    page: number,
    sessdata: string,
  ): Promise<FavoriteFolderPage> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= 2; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      try {
        const response = await fetch(
          `https://api.bilibili.com/x/v3/fav/resource/list?media_id=${folder.id}&pn=${page}&ps=20`,
          {
            headers: { Cookie: `SESSDATA=${sessdata}` },
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        if (data.code !== 0) {
          throw new Error(data.message || "B 站接口返回失败");
        }
        if (!data.data || (data.data.medias != null && !Array.isArray(data.data.medias))) {
          throw new Error("收藏夹资源数据格式异常");
        }

        return {
          medias: data.data.medias || [],
          hasMore: Boolean(data.data.has_more),
        };
      } catch (error) {
        lastError = error;
        if (attempt < 2) {
          console.warn(`请求收藏夹 ${folder.title} 第 ${page} 页失败，正在重试 (${attempt}/2)`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }

    const reason = lastError instanceof Error ? `：${lastError.message}` : "";
    throw new Error(`获取收藏夹「${folder.title}」第 ${page} 页失败${reason}`);
  }

  async function syncFavoriteFolderResources(
    folder: FavoriteFolder,
    sessdata: string,
    isFullSync: boolean,
  ): Promise<void> {
    console.log(`正在同步收藏夹: ${folder.title} (${isFullSync ? "全量" : "增量"})`);

    const localResources = await getFavResources(folder.id);
    const existingResourceIds = new Set(localResources.map((item) => item.id));
    const onlineResourceIds = new Set<number>();

    let page = 1;
    let allPagesFetched = false;

    while (true) {
      const { medias, hasMore } = await fetchFavoriteFolderPage(folder, page, sessdata);

      if (medias.length === 0) {
        if (hasMore) throw new Error(`收藏夹「${folder.title}」分页数据异常`);
        allPagesFetched = true;
        break;
      }

      const resourceIds = medias.map((media: any) => Number(media.id));
      if (resourceIds.some((id: number) => !Number.isSafeInteger(id) || id <= 0)) {
        throw new Error(`收藏夹「${folder.title}」资源数据格式异常`);
      }

      resourceIds.forEach((id: number) => onlineResourceIds.add(id));

      const reachedLocalBoundary =
        !isFullSync &&
        existingResourceIds.has(resourceIds[0]) &&
        existingResourceIds.has(resourceIds[resourceIds.length - 1]);

      const resources = medias.map((media: any, index: number) => ({
        ...media,
        folder_id: folder.id,
        index: (page - 1) * 20 + index,
        id: resourceIds[index],
        bv_id: media.bv_id || media.bvid,
      }));
      await saveFavResources(resources);

      if (!hasMore) {
        allPagesFetched = true;
        break;
      }
      if (reachedLocalBoundary) break;

      page += 1;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (isFullSync) {
      if (!allPagesFetched) {
        throw new Error(`收藏夹「${folder.title}」未完整同步，已跳过本地清理`);
      }

      const idsToDelete = localResources
        .filter((item) => !onlineResourceIds.has(item.id))
        .map((item) => item.id);

      if (idsToDelete.length > 0) {
        await deleteFavResources(idsToDelete);
        console.log(`从收藏夹 "${folder.title}" 删除了 ${idsToDelete.length} 个已取消收藏的项目`);
      }
    }
  }

  async function syncFavoriteFolderById(
    folderId: number,
    isFullSync: boolean,
  ): Promise<FavoriteFolder> {
    const { sessdata, folders } = await getFavoriteFoldersFromBilibili();
    const folder = folders.find((item) => item.id === folderId);
    if (!folder) throw new Error("收藏夹不存在或无权访问");

    await saveFavFolders([folder]);
    await syncFavoriteFolderResources(folder, sessdata, isFullSync);
    return folder;
  }

  async function syncFavorites(isFullSync = false): Promise<void> {
    try {
      const { sessdata, folders } = await getFavoriteFoldersFromBilibili();

      if (folders.length > 0) {
        await saveFavFolders(folders);
        console.log(`同步了 ${folders.length} 个收藏夹`);
      }

      for (const folder of folders) {
        await syncFavoriteFolderResources(folder, sessdata, isFullSync);
      }
    } catch (error) {
      console.error("同步收藏夹过程出错:", error);
      throw error;
    }
  }


  async function syncSubscribedCollections(): Promise<void> {
    const sessdata = await getBilibiliSession();
    const currentMid = await getCurrentBilibiliMid(sessdata);
    const pageSize = 50;
    let page = 1;
    let total = Infinity;
    const collections: SubscribedCollection[] = [];

    while (collections.length < total) {
      const response = await fetch(
        `https://api.bilibili.com/x/v3/fav/folder/collected/list?pn=${page}&ps=${pageSize}&up_mid=${currentMid}&platform=web&web_location=333.1387`,
        { headers: { Cookie: `SESSDATA=${sessdata}` } },
      );
      if (!response.ok) throw new Error("获取订阅合集失败");

      const data = await response.json();
      if (data.code !== 0) throw new Error(data.message || "获取订阅合集失败");

      // 该接口在 platform=web 时会同时返回普通收藏夹(type=11)和视频合集(type=21)。
      // 只有 type=21 的 id 才能作为 season_id 传给合集详情接口。
      const list = (data.data?.list || []).filter(
        (item: any) =>
          Number(item.type) === 21 &&
          !(item.title === "该合集已失效" && Number(item.upper?.mid) === 0),
      );
      total = Number(data.data?.count || 0);
      collections.push(
        ...list.map((item: any, index: number) => ({
          id: item.id,
          mid: item.mid,
          title: item.title || "未命名合集",
          cover: item.cover || "",
          intro: item.intro || "",
          ctime: item.ctime || 0,
          mtime: item.mtime || 0,
          media_count: item.media_count || 0,
          upper: item.upper || { mid: item.mid, name: "未知 UP 主", face: "" },
          index: collections.length + index,
        })),
      );

      if (list.length < pageSize) break;
      page += 1;
    }

    await replaceSubscribedCollections(collections);
  }

  async function syncSubscribedCollectionResources(collectionId: number): Promise<void> {
    const sessdata = await getBilibiliSession();
    const pageSize = 30;
    let page = 1;
    let hasMore = true;
    const resources: SubscribedCollectionResource[] = [];

    while (hasMore) {
      const response = await fetch(
        `https://api.bilibili.com/x/space/fav/season/list?season_id=${collectionId}&pn=${page}&ps=${pageSize}`,
        {
          headers: {
            Cookie: `SESSDATA=${sessdata}`,
          },
        },
      );
      if (!response.ok) throw new Error("获取合集内容失败");

      const data = await response.json();
      if (data.code !== 0) throw new Error(data.message || "获取合集内容失败");

      const medias = data.data?.medias || [];
      resources.push(
        ...medias.map((media: any, index: number) => ({
          id: `${collectionId}-${media.id}`,
          collection_id: collectionId,
          aid: media.id,
          bvid: media.bvid || media.bv_id || "",
          title: media.title || "未命名视频",
          cover: media.cover || "",
          duration: media.duration || 0,
          author_name: media.upper?.name || "未知 UP 主",
          author_mid: media.upper?.mid || 0,
          pubdate: media.pubtime || media.ctime || 0,
          index: resources.length + index,
        })),
      );

      hasMore = Boolean(data.data?.has_more);
      page += 1;
    }

    await replaceSubscribedCollectionResources(collectionId, resources);
  }

  // WebDAV 同步数据项定义：文件名、本地读取与远端合并策略（与 WebDavSync 页面保持一致）
  const WEBDAV_DATA_ITEMS: {
    key: WebDavSyncKey;
    label: string;
    file: string;
    getAll: () => Promise<unknown[]>;
    merge: (items: any[]) => Promise<unknown>;
  }[] = [
    {
      key: "history",
      label: "历史",
      file: "history.json",
      getAll: getAllHistory,
      merge: smartMergeHistory,
    },
    {
      key: "likedMusic",
      label: "音乐",
      file: "likedMusic.json",
      getAll: getAllLikedMusic,
      merge: smartMergeLikedMusic,
    },
    {
      key: "favFolders",
      label: "收藏夹",
      file: "favFolders.json",
      getAll: getAllFavFolders,
      merge: importFavFolders,
    },
    {
      key: "favResources",
      label: "收藏",
      file: "favResources.json",
      getAll: getAllFavResources,
      merge: smartMergeFavResources,
    },
    {
      key: "subscribedCollections",
      label: "订阅合集",
      file: "subscribedCollections.json",
      getAll: getAllSubscribedCollections,
      merge: importSubscribedCollections,
    },
    {
      key: "subscribedCollectionResources",
      label: "合集视频",
      file: "subscribedCollectionResources.json",
      getAll: getAllSubscribedCollectionResources,
      merge: smartMergeSubscribedCollectionResources,
    },
  ];

  // WebDAV 自动双向同步：拉取 → 合并 → 推送（仅同步用户勾选的数据项）
  async function autoSyncWebDav(): Promise<void> {
    try {
      const config = await getStorageValue<WebDavConfig | null>(WEBDAV_CONFIG, null);
      if (!config || !config.serverUrl) {
        console.log("WebDAV 未配置，跳过自动同步");
        return;
      }

      const syncItems = await getStorageValue<WebDavSyncItems>(
        WEBDAV_SYNC_ITEMS,
        DEFAULT_WEBDAV_SYNC_ITEMS,
      );
      const items = WEBDAV_DATA_ITEMS.filter((item) => syncItems[item.key]);
      if (items.length === 0) {
        console.log("WebDAV 同步数据项均未勾选，跳过自动同步");
        return;
      }

      console.log(`开始 WebDAV 双向同步（${items.map((i) => i.label).join("、")}）...`);
      await ensureDirectory(config);

      // ===== 第一步：拉取远端数据并合并到本地 =====
      console.log("[WebDAV 同步] 步骤 1/2：拉取并合并远端数据...");
      for (const item of items) {
        const remote = await downloadFile(config, item.file);
        if (remote) {
          await item.merge(JSON.parse(remote));
        }
      }

      // ===== 第二步：将合并后的最新本地数据推送到远端 =====
      console.log("[WebDAV 同步] 步骤 2/2：推送本地数据到远端...");
      const summary: string[] = [];
      for (const item of items) {
        const data = await item.getAll();
        await uploadFile(config, item.file, JSON.stringify(data));
        summary.push(`${item.label} ${data.length}`);
      }

      // 同步完成，记录时间戳
      await setStorageValue(WEBDAV_LAST_SYNC, Date.now());

      console.log(`WebDAV 双向同步完成：${summary.join("，")}`);
    } catch (error) {
      console.error("WebDAV 双向同步失败:", error);
    }
  }
});
