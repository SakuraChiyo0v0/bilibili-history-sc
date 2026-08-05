import { useEffect, useState } from "react";
import { HashRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { History } from "../../pages/History";
import { About } from "../../pages/About";
import { Sidebar } from "../../components/Sidebar";
import Settings from "../../pages/Settings";
import ScrollToTopButton from "../../components/ScrollToTopButton";
import { Toaster } from "react-hot-toast";
import Feedback from "../../pages/Feedback";
import CloudSync from "../../pages/CloudSync";
import WebDavSync from "../../pages/WebDavSync";
import SearchMusic from "../../pages/music/SearchMusic";
import LikedMusic from "../../pages/music/LikedMusic";
import { Favorites } from "../../pages/Favorites";
import Welcome from "../../pages/Welcome";
import AISearch from "../../pages/AISearch";
import Reward from "../../pages/Reward";
import { UpdateNoticeModal } from "../../components/UpdateNoticeModal";
import SubscribedCollections from "../../pages/SubscribedCollections";
import { INITIAL_SETUP_COMPLETED } from "../../utils/constants";
import { getStorageValue } from "../../utils/storage";
import { GlobalPlayerProvider } from "../../components/GlobalPlayerProvider";

const MainLayout = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  const isSetupFlow =
    location.pathname === "/welcome" ||
    (location.pathname === "/webdav-sync" &&
      new URLSearchParams(location.search).get("onboarding") === "1");

  return (
    <div className="flex h-screen dark:bg-[#0a0a0a] dark:text-neutral-100">
      {!isSetupFlow && <Sidebar />}
      {/* 主内容区域 */}
      <div className={`${!isSetupFlow ? "ml-40" : ""} w-full transition-all duration-300`}>
        {children}
      </div>
      {!isSetupFlow && <UpdateNoticeModal />}
    </div>
  );
};

const AppRoutes = () => {
  const location = useLocation();
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null);

  useEffect(() => {
    getStorageValue(INITIAL_SETUP_COMPLETED, true).then((completed) => {
      setSetupRequired(!completed);
    });

    const handleStorageChange = (
      changes: Record<string, Browser.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName === "local" && changes[INITIAL_SETUP_COMPLETED]) {
        setSetupRequired(!changes[INITIAL_SETUP_COMPLETED].newValue);
      }
    };
    browser.storage.onChanged.addListener(handleStorageChange);
    return () => browser.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  if (setupRequired === null) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">
        正在准备应用...
      </div>
    );
  }

  const isWebDavOnboarding =
    location.pathname === "/webdav-sync" &&
    new URLSearchParams(location.search).get("onboarding") === "1";
  const isSetupRoute = location.pathname === "/welcome" || isWebDavOnboarding;

  if (setupRequired && !isSetupRoute) {
    return <Navigate to="/welcome" replace />;
  }

  if (!setupRequired && location.pathname === "/welcome") {
    return <Navigate to="/" replace />;
  }

  return (
    <Routes>
      <Route path="/welcome" element={<Welcome />} />
      <Route path="/" element={<History />} />
      <Route path="/about" element={<About />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/feedback" element={<Feedback />} />
      <Route path="/cloud-sync" element={<CloudSync />} />
      <Route path="/webdav-sync" element={<WebDavSync />} />
      <Route path="/reward" element={<Reward />} />
      <Route path="/favorites" element={<Favorites />} />
      <Route path="/collections" element={<SubscribedCollections />} />
      <Route path="/ai-search" element={<AISearch />} />
      <Route path="/music/search" element={<SearchMusic />} />
      <Route path="/music/liked" element={<LikedMusic />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

const App = () => {
  return (
    <HashRouter>
      <Toaster position="top-center" />
      <GlobalPlayerProvider>
        <MainLayout>
          <AppRoutes />
          <ScrollToTopButton />
        </MainLayout>
      </GlobalPlayerProvider>
    </HashRouter>
  );
};

export default App;
