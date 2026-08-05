import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { createShuffleOrder, ensureShuffleLookahead } from "@/utils/playerShuffle";
import { BilibiliDashPlayer } from "./BilibiliDashPlayer";

export interface GlobalPlayerTrack {
  id: string;
  bvid: string;
  title: string;
}

interface PlayerQueue {
  tracks: GlobalPlayerTrack[];
  currentIndex: number;
  shuffleOrder: number[] | null;
  shufflePosition: number;
}

interface GlobalPlayerContextValue {
  playTracks: (tracks: GlobalPlayerTrack[], currentIndex: number) => void;
  closePlayer: () => void;
}

const GlobalPlayerContext = createContext<GlobalPlayerContextValue | null>(null);

export const useGlobalPlayer = () => {
  const context = useContext(GlobalPlayerContext);
  if (!context) throw new Error("useGlobalPlayer 必须在 GlobalPlayerProvider 中使用");
  return context;
};

export const GlobalPlayerProvider = ({ children }: { children: React.ReactNode }) => {
  const [queue, setQueue] = useState<PlayerQueue | null>(null);

  const playTracks = useCallback((tracks: GlobalPlayerTrack[], currentIndex: number) => {
    if (!tracks.length || currentIndex < 0 || currentIndex >= tracks.length) return;
    setQueue((current) => {
      const keepShuffleEnabled = Boolean(current?.shuffleOrder) && tracks.length > 1;
      return {
        tracks,
        currentIndex,
        shuffleOrder: keepShuffleEnabled ? createShuffleOrder(tracks.length, currentIndex) : null,
        shufflePosition: 0,
      };
    });
  }, []);

  const closePlayer = useCallback(() => setQueue(null), []);
  const contextValue = useMemo(() => ({ playTracks, closePlayer }), [playTracks, closePlayer]);
  const currentTrack = queue?.tracks[queue.currentIndex];
  const isShuffleEnabled = Boolean(queue?.shuffleOrder);
  const previousIndex = queue?.shuffleOrder
    ? queue.shuffleOrder[queue.shufflePosition - 1]
    : queue && queue.currentIndex > 0
      ? queue.currentIndex - 1
      : undefined;
  const nextIndex = queue?.shuffleOrder
    ? queue.shuffleOrder[queue.shufflePosition + 1]
    : queue && queue.currentIndex < queue.tracks.length - 1
      ? queue.currentIndex + 1
      : undefined;

  const toggleShuffle = useCallback(() => {
    setQueue((current) => {
      if (!current || current.tracks.length < 2) return current;
      if (current.shuffleOrder) {
        return { ...current, shuffleOrder: null, shufflePosition: 0 };
      }
      return {
        ...current,
        shuffleOrder: createShuffleOrder(current.tracks.length, current.currentIndex),
        shufflePosition: 0,
      };
    });
  }, []);

  const playPrevious = useCallback(() => {
    setQueue((current) => {
      if (!current) return current;
      if (!current.shuffleOrder) {
        return current.currentIndex > 0
          ? { ...current, currentIndex: current.currentIndex - 1 }
          : current;
      }
      if (current.shufflePosition <= 0) return current;
      const shufflePosition = current.shufflePosition - 1;
      return {
        ...current,
        currentIndex: current.shuffleOrder[shufflePosition],
        shufflePosition,
      };
    });
  }, []);

  const playNext = useCallback(() => {
    setQueue((current) => {
      if (!current) return current;
      if (!current.shuffleOrder) {
        return current.currentIndex < current.tracks.length - 1
          ? { ...current, currentIndex: current.currentIndex + 1 }
          : current;
      }

      const shufflePosition = current.shufflePosition + 1;
      if (shufflePosition >= current.shuffleOrder.length) return current;
      const shuffleOrder = ensureShuffleLookahead(
        current.shuffleOrder,
        shufflePosition,
        current.tracks.length,
      );
      return {
        ...current,
        currentIndex: shuffleOrder[shufflePosition],
        shuffleOrder,
        shufflePosition,
      };
    });
  }, []);

  return (
    <GlobalPlayerContext.Provider value={contextValue}>
      {children}
      {queue && currentTrack && (
        <BilibiliDashPlayer
          bvid={currentTrack.bvid}
          title={currentTrack.title}
          onClose={closePlayer}
          hasPrevious={previousIndex !== undefined}
          hasNext={nextIndex !== undefined}
          nextBvid={nextIndex === undefined ? undefined : queue.tracks[nextIndex]?.bvid}
          isShuffleEnabled={isShuffleEnabled}
          onToggleShuffle={toggleShuffle}
          onPrevious={playPrevious}
          onNext={playNext}
        />
      )}
    </GlobalPlayerContext.Provider>
  );
};
