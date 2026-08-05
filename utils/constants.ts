export const IS_SYNC_DELETE = "isSyncDelete";
export const IS_SYNC_DELETE_FROM_BILIBILI = "isSyncDeleteFromBilibili";

export const IS_SYNCING = "isSyncing";
export const IS_SYNCING_FAV = "isSyncingFav";

export const HAS_FULL_SYNC = "hasFullSync";
export const HAS_FULL_FAV_SYNC = "hasFullFavSync";

export const SYNC_INTERVAL = "syncInterval";

export const SYNC_TIME_REMAIN = "syncTimeRemain";

export const FAV_AUTO_SYNC_ENABLED = "favAutoSyncEnabled"; // auto favorites sync switch, default false
export const FAV_SYNC_INTERVAL = "favSyncInterval"; // 单位：分钟，默认 60*24 (1天)
export const FAV_SYNC_TIME_REMAIN = "favSyncTimeRemain"; // 单位：分钟

export const HIDE_USER_INFO = "hideUserInfo";
export const HIDDEN_MENUS = "hiddenMenus"; // Array of hidden titles
export const SYNC_PROGRESS_HISTORY = "syncProgressHistory";
export const SYNC_PROGRESS_FAV = "syncProgressFav";
export const SYNC_PROGRESS_COLLECTIONS = "syncProgressCollections";
export const DATE_SELECTION_MODE = "date_selection_mode";
export const GRID_COLUMNS = "gridColumns";
export const VIDEO_CLICK_MODES = "videoClickModes";
export const LAST_SEEN_UPDATE_VERSION = "lastSeenUpdateVersion";

// 仅全新安装时设为 false；旧版本升级时缺少该键，按已完成处理
export const INITIAL_SETUP_COMPLETED = "initialSetupCompleted";

// WebDAV 同步相关
export const WEBDAV_CONFIG = "webdavConfig";
export const WEBDAV_LAST_SYNC = "webdavLastSync";
export const WEBDAV_AUTO_SYNC_ENABLED = "webdavAutoSyncEnabled";
export const WEBDAV_AUTO_SYNC_INTERVAL = "webdavAutoSyncInterval"; // 单位：分钟，默认 30

export const DASHSCOPE_API_KEY = "dashscopeApiKey";
export const AI_SEARCH_HISTORY = "aiSearchHistory";

// "light" | "dark"
export const THEME_MODE = "themeMode";

export const UPDATE_HISTORY = [
  {
    date: "2026-07-20",
    version: "2.2.1",
    changes: [
      "修复自定义系统画中画在小尺寸窗口中的布局：音乐控制条与视频控制界面会根据实际可用区域统一等比缩放，避免挤压和裁切。",
      "播放器新增伪随机播放：每轮洗牌后逐首播放且不重复，上一首按真实播放历史返回，并提前确定下一首以预取 DASH 播放流信息。",
    ],
  },
  {
    date: "2026-07-20",
    version: "2.2.0",
    changes: [
      "内置播放器支持缩小为可拖动悬浮窗，并可在历史记录、收藏夹、合集及其他扩展页面之间持续播放。",
      "视频播放器新增自定义系统级画中画与 Media Session 控制：视频模式显示真实画面，音乐模式显示紧凑封面控制条，并可在两种模式间保留进度切换。",
    ],
  },
  {
    date: "2026-07-20",
    version: "2.1.0",
    changes: [
      "新增首次启动数据来源选择：可从 B 站全量拉取，或先配置 WebDAV 并从云端恢复。",
      "全新安装在用户完成选择前暂停后台自动同步，避免重新安装后立即产生大量 B 站请求。",
      "WebDAV 首次恢复会验证并保存配置，将云端数据作为本机同步基线，后续从增量同步开始。",
      "侧边栏菜单管理新增“隐藏赞赏”选项。",
    ],
  },
  {
    date: "2026-07-20",
    version: "2.0.2",
    changes: [
      "WebDAV 支持同步主题、隐藏菜单和历史记录/收藏夹/订阅合集的视频点击行为；应用远端偏好前会请求确认。",
      "自动 WebDAV 同步改为仅传输本地缓存，避免周期性全量请求 B 站收藏夹与合集接口触发风控；手动备份和双向同步仍会完整刷新数据。",
      "优化 B 站接口请求的完整登录态、超时重试和错误提示，降低 HTTP 412 等风控响应导致的同步失败。",
      "修复订阅合集同步：筛除混入列表的普通收藏夹，仅同步 type=21 的视频合集，并恢复使用合集专用内容接口。",
      "设置页新增订阅合集同步进度展示，合集与视频数据可继续纳入 WebDAV 备份、导入导出和双向合并。",
    ],
  },
  {
    date: "2026-07-19",
    version: "2.0.0",
    changes: [
      "新增订阅合集页面：可浏览已订阅合集及其视频内容，并支持同步刷新。",
      "新增收藏夹与订阅合集管理：可修改或删除收藏夹、移出收藏内容，以及取消订阅合集；操作会同步到 B 站并清理本地数据。",
      "订阅合集纳入 WebDAV 双向同步、导入导出与智能合并，跨设备使用时可完整保留合集及资源数据。",
      "完善收藏夹和合集的数据可靠性：修复资源来源、切换竞态与备份完整性问题；备份前会同步拉取完整资源列表。",
      "新增可配置的视频点击行为，可按历史记录、收藏夹和订阅合集分别选择跳转 B 站或在扩展内播放。",
      "扩展内播放器支持播放列表：自动连播下一条，也可使用上一条、下一条按钮切换。",
      "播放器升级为 Shaka Player DASH 播放，提供统一的播放、进度、音量、静音与全屏控制；音乐模式仅播放音频并展示视频封面。",
      "优化播放流畅性：缓存短期播放信息并预取下一条内容；网络或流地址失效时会重试、重新解析并尝试从当前进度恢复。",
      "修复音乐搜索请求的 Referer 规则和关键词编码问题，提升搜索稳定性。",
    ],
  },
  {
    date: "2026-07-08",
    version: "1.9.9",
    changes: [
      "增加赞赏名单",
      "为 DNR 规则 8 增加 initiatorDomains 限制发起方, 避免误伤 www 页搜索 API",
      "设置页增加自动同步收藏夹控制开关，开启以后插件才会在后台定时自动同步收藏夹数据",
    ],
  },
  {
    date: "2026-05-03",
    version: "1.9.8",
    changes: ["增加白天/黑夜模式", "增加更新特性的弹窗", "增加赞赏入口"],
  },
  {
    date: "2026-03-14",
    version: "1.9.7",
    changes: [
      "新增 AI语义探索 功能，输入API Key即可模糊寻找遗忘历史记录",
      "优化收藏夹同步机制为增量同步（按需重试机制），大幅减少API请求",
      "新增收藏夹界面专属深度搜索栏，支持实时检索（标题、UP主、AV/BV号等）",
      "优化标签UI：添加“已收藏”标志并重构历史徽章位置",
    ],
  },
  {
    date: "2026-03-02",
    version: "1.9.6",
    changes: ["新增WebDAV同步功能", "优化部分UI"],
  },
  {
    date: "2026-02-26",
    version: "1.9.5",
    changes: ["修复搜索音乐时搜索失败的问题"],
  },
  {
    date: "2026-02-23",
    version: "1.9.4",
    changes: [
      "修复更新插件后历史记录丢失的问题",
      "新增历史记录列数自定义调节功能",
      "修复多个TypeScript类型错误",
      "修复HMR 重载后就会复现历史记录页面无法滚动的bug",
    ],
  },
  {
    date: "2026-02-23",
    version: "1.9.3",
    changes: ["修复滚动加载更多却没有加载更多的bug", "历史记录的列数根据屏幕适配"],
  },
  {
    date: "2026-02-14",
    version: "1.9.2",
    changes: [
      "历史记录页面支持AV号搜索",
      "新增日期选择模式（范围选择/单日点击）",
      "修复切换筛选时无法刷新的问题",
      "添加观看进度显示",
      "添加搜索选项选择",
    ],
  },
  {
    date: "2026-02-05",
    version: "1.9.1",
    changes: [
      "历史记录搜索支持BV号搜索",
      "优化部分UI",
      "新增可隐藏并禁用侧边栏功能",
      "新增可视化同步进度条",
    ],
  },
  {
    date: "2026-02-02",
    version: "1.9.0beta",
    changes: [
      "历史记录支持按类型筛选",
      "收藏夹支持自动清理已取消收藏的内容",
      "收藏夹支持保留已失效视频的元数据",
      "收藏夹增加分页功能",
      "优化UI界面",
    ],
  },
  {
    date: "2025-11-10",
    version: "1.8.8",
    changes: ["同步删除：插件 -> B站, 不需要打开b站标签页"],
  },
  {
    date: "2025-10-22",
    version: "1.8.7",
    changes: ["修复播放模式的bug"],
  },
  {
    date: "2025-10-21",
    version: "1.8.6",
    changes: ["听歌页面增加随机播放和单曲循环功能"],
  },
  {
    date: "2025-10-16",
    version: "1.8.5",
    changes: ["修复了部分歌不能听的问题"],
  },
  {
    date: "2025-09-18",
    version: "1.8.4",
    changes: ["修复了部分歌不能听的问题"],
  },
  {
    date: "2025-09-16",
    version: "1.8.3",
    changes: ["修复了不能上传b站视频的bug"],
  },
  {
    date: "2025-09-14",
    version: "1.8.0",
    changes: ["增加听歌功能，超级棒！！！"],
  },
  {
    date: "2025-07-09",
    version: "1.7.2",
    changes: [
      "支持在B站网页端删除历史记录时同步删除插件历史记录",
      "修复刷新按钮不刷新总记录数的bug",
    ],
  },
  {
    date: "2025-06-28",
    version: "1.7.1",
    changes: ["优化云同步功能(正式启用)", "显示历史记录总数", "优化关于和反馈页面"],
  },
  {
    date: "2025-06-15",
    version: "1.7.0",
    changes: ["增加云同步功能(测试阶段)", "pop中可选择增量同步或者全量同步", "优化菜单项"],
  },
  {
    date: "2025-05-30",
    version: "1.6.2",
    changes: ["修复了旧版本专栏的跳转", "间隔时间可以手动输入"],
  },
  {
    date: "2025-05-28",
    version: "1.6.1",
    changes: ["日期选择增加+、-按钮"],
  },
  {
    date: "2025-05-24",
    version: "1.6.0",
    changes: ["代码开源", "增加设置自动同步时间间隔功能"],
  },
  {
    date: "2025-05-22",
    version: "1.5.0",
    changes: ["修改导出功能，增加导入功能"],
  },
  {
    date: "2025-05-18",
    version: "1.4.2",
    changes: ["修复了打开浏览器历史页面跳转到插件页面的问题"],
  },
  {
    date: "2025-05-18",
    version: "1.4.1",
    changes: ["修复了1.4.0版本引入的视频跳转的bug"],
  },
  {
    date: "2025-05-18",
    version: "1.4.0",
    changes: ["修复了番剧和课堂的跳转", "侧边栏添加了更新日志和反馈"],
  },
] as const;
