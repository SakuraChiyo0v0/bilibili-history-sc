import { useEffect, useState, useRef } from "react";
import { getFavFolders, getFavResources } from "../utils/db";
import { FavoriteFolder, FavoriteResource } from "../utils/types";
import { ArrowRightLeft, Folder, Pencil, Search, Trash2, X, ChevronDownIcon } from "lucide-react";
import { Pagination } from "../components/Pagination";
import { BilibiliDashPlayer } from "../components/BilibiliDashPlayer";
import { useVideoClickMode } from "../hooks/useVideoClickMode";
import { ContextMenu } from "../components/ContextMenu";
import { ActionDialog } from "../components/ActionDialog";
import toast from "react-hot-toast";

type FavoritesContextTarget =
  | { type: "folder"; folder: FavoriteFolder }
  | { type: "resource"; resource: FavoriteResource };

type FavoritesDialog =
  | { type: "edit-folder"; folder: FavoriteFolder }
  | { type: "delete-folder"; folder: FavoriteFolder }
  | { type: "delete-resource"; resource: FavoriteResource }
  | { type: "move-resource"; resource: FavoriteResource };

export const Favorites = () => {
  const [folders, setFolders] = useState<FavoriteFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [resources, setResources] = useState<FavoriteResource[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [searchType, setSearchType] = useState<"all" | "title" | "up" | "bvid" | "avid">("all");
  const [isSearchKindDropdownOpen, setIsSearchKindDropdownOpen] = useState(false);
  const [playingResource, setPlayingResource] = useState<FavoriteResource | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    target: FavoritesContextTarget;
  } | null>(null);
  const [dialog, setDialog] = useState<FavoritesDialog | null>(null);
  const [folderTitle, setFolderTitle] = useState("");
  const [targetFolderId, setTargetFolderId] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const videoClickMode = useVideoClickMode("favorites");
  const pageSize = 50;

  const contentRef = useRef<HTMLDivElement>(null);
  const selectedFolderIdRef = useRef<number | null>(null);
  const resourceLoadRequestIdRef = useRef(0);

  useEffect(() => {
    loadFolders();
  }, []);

  useEffect(() => {
    selectedFolderIdRef.current = selectedFolderId;
  }, [selectedFolderId]);

  useEffect(() => {
    if (selectedFolderId) {
      loadResources(selectedFolderId);
    } else if (folders.length > 0) {
      // Default select first folder
      setSelectedFolderId(folders[0].id);
    }
  }, [folders, selectedFolderId]);

  const loadFolders = async () => {
    try {
      const list = await getFavFolders();
      // Sort by index
      const sortedList = list.sort((a, b) => (a.index || 0) - (b.index || 0));
      setFolders(sortedList);
    } catch (error) {
      console.error("加载收藏夹失败", error);
    }
  };

  const loadResources = async (folderId: number) => {
    const requestId = ++resourceLoadRequestIdRef.current;
    setLoading(true);
    try {
      const list = await getFavResources(folderId);
      if (selectedFolderIdRef.current !== folderId) return;

      // Sort by index
      const sortedList = list.sort((a, b) => (a.index || 0) - (b.index || 0));
      setResources(sortedList);
      setCurrentPage(1);
      setKeyword("");
    } catch (error) {
      console.error("加载收藏资源失败", error);
    } finally {
      if (requestId === resourceLoadRequestIdRef.current) setLoading(false);
    }
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    // Scroll to top of content
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  };

  const handleDialogConfirm = async () => {
    if (!dialog) return;
    if (dialog.type === "edit-folder" && !folderTitle.trim()) {
      toast.error("收藏夹名称不能为空");
      return;
    }
    if (dialog.type === "move-resource" && !targetFolderId) {
      toast.error("请选择目标收藏夹");
      return;
    }

    setIsSubmitting(true);
    try {
      if (dialog.type === "edit-folder") {
        const response = await browser.runtime.sendMessage({
          action: "editFavFolder",
          folderId: dialog.folder.id,
          title: folderTitle.trim(),
        });
        if (!response?.success) throw new Error(response?.error || "修改收藏夹失败");
        setFolders((current) =>
          current.map((folder) =>
            folder.id === dialog.folder.id ? { ...folder, title: folderTitle.trim() } : folder,
          ),
        );
        toast.success("收藏夹名称已修改");
      } else if (dialog.type === "delete-folder") {
        const response = await browser.runtime.sendMessage({
          action: "deleteFavFolder",
          folderId: dialog.folder.id,
        });
        if (!response?.success) throw new Error(response?.error || "删除收藏夹失败");
        const remainingFolders = folders.filter((folder) => folder.id !== dialog.folder.id);
        setFolders(remainingFolders);
        setSelectedFolderId((currentId) =>
          currentId === dialog.folder.id ? (remainingFolders[0]?.id ?? null) : currentId,
        );
        if (selectedFolderId === dialog.folder.id) {
          setResources([]);
          setPlayingResource(null);
        }
        toast.success("收藏夹已删除");
      } else if (dialog.type === "delete-resource") {
        const response = await browser.runtime.sendMessage({
          action: "deleteFavResource",
          folderId: dialog.resource.folder_id,
          resourceId: dialog.resource.id,
          resourceType: dialog.resource.type,
        });
        if (!response?.success) throw new Error(response?.error || "移出收藏夹失败");
        setResources((current) => current.filter((resource) => resource.id !== dialog.resource.id));
        setPlayingResource((current) =>
          current?.id === dialog.resource.id ? null : current,
        );
        toast.success("已移出当前收藏夹");
      } else {
        const response = await browser.runtime.sendMessage({
          action: "moveFavResource",
          sourceFolderId: dialog.resource.folder_id,
          targetFolderId,
          resourceId: dialog.resource.id,
          resourceType: dialog.resource.type,
        });
        if (!response?.success) throw new Error(response?.error || "移动收藏内容失败");
        setResources((current) => current.filter((resource) => resource.id !== dialog.resource.id));
        setPlayingResource((current) => (current?.id === dialog.resource.id ? null : current));
        toast.success("内容已移动");
      }
      setDialog(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredResources = resources.filter((item) => {
    if (!keyword) return true;
    const lowerKeyword = keyword.toLowerCase();

    switch (searchType) {
      case "title":
        return item.title.toLowerCase().includes(lowerKeyword);
      case "up":
        return item.upper?.name.toLowerCase().includes(lowerKeyword);
      case "bvid":
        return item.bvid && item.bvid.toLowerCase().includes(lowerKeyword);
      case "avid":
        return item.id && String(item.id).includes(lowerKeyword);
      case "all":
      default:
        return (
          item.title.toLowerCase().includes(lowerKeyword) ||
          item.upper?.name.toLowerCase().includes(lowerKeyword) ||
          (item.bvid && item.bvid.toLowerCase().includes(lowerKeyword)) ||
          (item.id && String(item.id).includes(lowerKeyword))
        );
    }
  });

  const startIndex = (currentPage - 1) * pageSize;
  const currentResources = filteredResources.slice(startIndex, startIndex + pageSize);
  const playableResources = filteredResources.filter((item) => Boolean(item.bvid));
  const contextFolder = contextMenu?.target.type === "folder" ? contextMenu.target : null;
  const contextResource = contextMenu?.target.type === "resource" ? contextMenu.target : null;
  const playingResourceIndex = playingResource
    ? playableResources.findIndex((item) => item.id === playingResource.id)
    : -1;

  useEffect(() => {
    if (playingResource && playingResourceIndex === -1) setPlayingResource(null);
  }, [playingResource, playingResourceIndex]);

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-[#0a0a0a]">
      {/* 左侧收藏夹列表 */}
      <div className="w-64 bg-white dark:bg-neutral-900 border-r border-gray-200 dark:border-neutral-800 overflow-y-auto flex-shrink-0">
        <div className="p-4 border-b border-gray-200 dark:border-neutral-800">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Folder className="w-5 h-5" />
            我的收藏夹
          </h2>
        </div>
        <div className="p-2">
          {folders.map((folder) => (
            <div
              key={folder.id}
              className={`p-3 rounded-lg cursor-pointer mb-1 transition-colors ${
                selectedFolderId === folder.id
                  ? "bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400"
                  : "hover:bg-gray-100 dark:hover:bg-neutral-800"
              }`}
              onClick={() => {
                selectedFolderIdRef.current = folder.id;
                setSelectedFolderId(folder.id);
                setPlayingResource(null);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                setContextMenu({ x: event.clientX, y: event.clientY, target: { type: "folder", folder } });
              }}
            >
              <div className="font-medium truncate">{folder.title}</div>
              <div className="text-xs text-gray-400 dark:text-neutral-500 mt-1">
                {folder.media_count}个内容
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 右侧内容列表 */}
      <div className="flex-1 overflow-y-auto" ref={contentRef}>
        <div className="p-6">
          {selectedFolderId && (
            <div className="mb-6 flex flex-col md:flex-row justify-between md:items-center gap-4 bg-white dark:bg-neutral-900 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-neutral-800">
              <h1 className="text-xl font-bold flex items-center gap-2">
                {folders.find((f) => f.id === selectedFolderId)?.title}
                <span className="text-sm font-normal text-gray-500 dark:text-neutral-400 bg-gray-50 dark:bg-neutral-800 px-2 py-1 rounded-full border border-gray-100 dark:border-neutral-700 whitespace-nowrap">
                  {filteredResources.length} 个内容
                </span>
              </h1>

              <div className="relative w-full md:max-w-xl group flex items-center bg-gray-50 dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-full transition-all duration-300 shadow-sm hover:shadow-md focus-within:bg-white dark:focus-within:bg-neutral-800 focus-within:ring-2 focus-within:ring-blue-100 dark:focus-within:ring-blue-500/20 focus-within:border-blue-400 dark:focus-within:border-blue-500">
                {/* 搜索类型下拉 */}
                <div className="relative">
                  <button
                    className="pl-4 pr-3 py-2 text-sm text-gray-600 dark:text-neutral-300 font-medium cursor-pointer border-r border-gray-200 dark:border-neutral-700 hover:text-blue-600 dark:hover:text-blue-400 flex items-center gap-1 transition-colors whitespace-nowrap"
                    onClick={() => setIsSearchKindDropdownOpen(!isSearchKindDropdownOpen)}
                  >
                    <span>
                      {searchType === "all" && "综合"}
                      {searchType === "title" && "标题"}
                      {searchType === "up" && "UP主"}
                      {searchType === "bvid" && "BV号"}
                      {searchType === "avid" && "AV号"}
                    </span>
                    <ChevronDownIcon className="w-3 h-3 text-gray-400 dark:text-neutral-500" />
                  </button>

                  {isSearchKindDropdownOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setIsSearchKindDropdownOpen(false)}
                      ></div>
                      <div className="absolute top-full left-0 mt-2 w-28 bg-white dark:bg-neutral-900 rounded-lg shadow-lg border border-gray-100 dark:border-neutral-800 py-1 z-20 animate-in fade-in zoom-in-95 duration-200 overflow-hidden">
                        {[
                          { value: "all", label: "综合搜索" },
                          { value: "title", label: "视频标题" },
                          { value: "up", label: "UP主" },
                          { value: "bvid", label: "视频BV号" },
                          { value: "avid", label: "视频AV号" },
                        ].map((option) => (
                          <button
                            key={option.value}
                            className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                              searchType === option.value
                                ? "bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium"
                                : "text-gray-600 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-800"
                            }`}
                            onClick={() => {
                              setSearchType(option.value as any);
                              setIsSearchKindDropdownOpen(false);
                            }}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                <input
                  type="text"
                  className="flex-1 bg-transparent border-none focus:ring-0 pl-4 pr-10 py-2 text-sm text-gray-700 dark:text-neutral-100 placeholder-gray-400 dark:placeholder-neutral-500 focus:outline-none"
                  placeholder={
                    searchType === "bvid"
                      ? "输入BV号..."
                      : searchType === "avid"
                        ? "输入AV号..."
                        : searchType === "up"
                          ? "输入UP主名称..."
                          : "搜索..."
                  }
                  value={keyword}
                  onChange={(e) => {
                    setKeyword(e.target.value);
                    setCurrentPage(1);
                  }}
                />
                {keyword ? (
                  <button
                    onClick={() => {
                      setKeyword("");
                      setCurrentPage(1);
                    }}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 dark:text-neutral-500 hover:text-gray-600 dark:hover:text-neutral-300 transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : (
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                    <Search className="h-4 w-4 text-gray-400 dark:text-neutral-500" />
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="w-full">
            {loading ? (
              <div className="text-center py-10 text-gray-500 dark:text-neutral-400">加载中...</div>
            ) : (
              <>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-6">
                  {currentResources.map((item) => (
                    <div
                      key={item.id}
                      className="border border-gray-200 dark:border-neutral-800 rounded-lg overflow-hidden flex flex-col bg-white dark:bg-neutral-900 hover:shadow-md transition-shadow"
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setContextMenu({
                          x: event.clientX,
                          y: event.clientY,
                          target: { type: "resource", resource: item },
                        });
                      }}
                    >
                      <a
                        href={`https://www.bilibili.com/video/${item.bvid}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(event) => {
                          if (videoClickMode !== "player" || !item.bvid) return;
                          event.preventDefault();
                          setPlayingResource(item);
                        }}
                        className="no-underline text-inherit flex flex-col h-full"
                      >
                        <div>
                          <div className="relative w-full aspect-video">
                            <img
                              src={`${item.cover.replace("http:", "https:")}@760w_428h_1c.avif`}
                              alt={item.title}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          </div>
                          <div className="p-3 flex-1 flex flex-col">
                            <div className="flex items-start justify-between gap-2">
                              <h3
                                className="m-0 text-sm leading-[1.4] h-10 overflow-hidden line-clamp-2 flex-1"
                                title={item.title}
                              >
                                {item.title}
                              </h3>
                            </div>
                            <div className="flex justify-between items-center text-gray-500 dark:text-neutral-400 text-xs mt-2">
                              <span
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  window.open(
                                    `https://space.bilibili.com/${item.upper?.mid}`,
                                    "_blank",
                                  );
                                }}
                                className="hover:text-[#fb7299] transition-colors cursor-pointer truncate mr-2"
                              >
                                {item.upper?.name}
                              </span>
                              <span className="shrink-0">
                                {new Date(
                                  (item.fav_time || item.ctime) * 1000,
                                ).toLocaleDateString()}
                              </span>
                            </div>
                          </div>
                        </div>
                      </a>
                    </div>
                  ))}
                  {currentResources.length === 0 && (
                    <div className="col-span-full text-center py-10 text-gray-400 dark:text-neutral-500">
                      这个收藏夹是空的
                    </div>
                  )}
                </div>
                <div className="mt-8">
                  <Pagination
                    currentPage={currentPage}
                    totalItems={filteredResources.length}
                    pageSize={pageSize}
                    onPageChange={handlePageChange}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      {playingResource && (
        <BilibiliDashPlayer
          bvid={playingResource.bvid}
          title={playingResource.title}
          onClose={() => setPlayingResource(null)}
          hasPrevious={playingResourceIndex > 0}
          hasNext={playingResourceIndex < playableResources.length - 1}
          nextBvid={playableResources[playingResourceIndex + 1]?.bvid}
          onPrevious={() => setPlayingResource(playableResources[playingResourceIndex - 1])}
          onNext={() => setPlayingResource(playableResources[playingResourceIndex + 1])}
        />
      )}
      <ContextMenu
        position={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
        onClose={() => setContextMenu(null)}
        items={
          contextFolder
            ? [
                {
                  label: "修改名称",
                  icon: <Pencil className="h-4 w-4" />,
                  onSelect: () => {
                    setFolderTitle(contextFolder.folder.title);
                    setDialog({ type: "edit-folder", folder: contextFolder.folder });
                  },
                },
                {
                  label: "删除收藏夹",
                  icon: <Trash2 className="h-4 w-4" />,
                  danger: true,
                  onSelect: () => setDialog({ type: "delete-folder", folder: contextFolder.folder }),
                },
              ]
            : contextResource
              ? [
                  {
                    label: "移出当前收藏夹",
                    icon: <Trash2 className="h-4 w-4" />,
                    danger: true,
                    onSelect: () =>
                      setDialog({ type: "delete-resource", resource: contextResource.resource }),
                  },
                  ...(folders.some((folder) => folder.id !== contextResource.resource.folder_id)
                    ? [
                        {
                          label: "移动到其他收藏夹",
                          icon: <ArrowRightLeft className="h-4 w-4" />,
                          onSelect: () => {
                            setTargetFolderId(
                              folders.find((folder) => folder.id !== contextResource.resource.folder_id)
                                ?.id ?? null,
                            );
                            setDialog({ type: "move-resource", resource: contextResource.resource });
                          },
                        },
                      ]
                    : []),
                ]
              : []
        }
      />
      <ActionDialog
        isOpen={Boolean(dialog)}
        title={
          dialog?.type === "edit-folder"
            ? "修改收藏夹名称"
            : dialog?.type === "delete-folder"
              ? "删除收藏夹"
              : dialog?.type === "move-resource"
                ? "移动收藏内容"
                : "移出收藏夹"
        }
        description={
          dialog?.type === "edit-folder"
            ? "修改会同步到 B 站。"
            : dialog?.type === "delete-folder"
              ? `确定删除“${dialog.folder.title}”吗？其中的收藏内容也会从 B 站移除。`
              : dialog?.type === "move-resource"
                ? "移动后，内容会从当前收藏夹移除。"
              : "确定将此内容从当前收藏夹移除吗？不会影响视频本身。"
        }
        confirmLabel={dialog?.type === "edit-folder" ? "保存" : "确认操作"}
        isDanger={dialog?.type === "delete-folder" || dialog?.type === "delete-resource"}
        isSubmitting={isSubmitting}
        onClose={() => setDialog(null)}
        onConfirm={handleDialogConfirm}
      >
        {dialog?.type === "edit-folder" && (
          <input
            autoFocus
            value={folderTitle}
            onChange={(event) => setFolderTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleDialogConfirm();
            }}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white dark:focus:ring-blue-500/20"
            maxLength={50}
          />
        )}
        {dialog?.type === "move-resource" && (
          <select
            value={targetFolderId ?? ""}
            onChange={(event) => setTargetFolderId(Number(event.target.value))}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white dark:focus:ring-blue-500/20"
          >
            {folders
              .filter((folder) => folder.id !== dialog.resource.folder_id)
              .map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.title}
                </option>
              ))}
          </select>
        )}
      </ActionDialog>
    </div>
  );
};

export default Favorites;
