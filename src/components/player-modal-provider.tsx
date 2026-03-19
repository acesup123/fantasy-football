"use client";

import { createContext, useContext, useState, useCallback } from "react";
import { PlayerCardModal } from "./player-card-modal";

interface PlayerModalContextType {
  openPlayer: (playerId: number) => void;
}

const PlayerModalContext = createContext<PlayerModalContextType>({
  openPlayer: () => {},
});

export function PlayerModalProvider({ children }: { children: React.ReactNode }) {
  const [activePlayerId, setActivePlayerId] = useState<number | null>(null);

  const openPlayer = useCallback((playerId: number) => {
    setActivePlayerId(playerId);
  }, []);

  return (
    <PlayerModalContext.Provider value={{ openPlayer }}>
      {children}
      {activePlayerId !== null && (
        <PlayerCardModal
          playerId={activePlayerId}
          onClose={() => setActivePlayerId(null)}
        />
      )}
    </PlayerModalContext.Provider>
  );
}

export function usePlayerModal() {
  return useContext(PlayerModalContext);
}
