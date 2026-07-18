// The single, app-global 现场 (live agent screen) target. Any avatar anywhere opens the one
// floating viewer through this context; <SceneOverlay> (mounted once) renders it. Keeps 现场
// opening decoupled from any particular page.

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

export interface SceneTarget {
  sid: string;
  agentUserId: number;
  nickname?: string;
}

interface SceneContextValue {
  current: SceneTarget | null;
  open: (target: SceneTarget) => void;
  close: () => void;
}

const SceneContext = createContext<SceneContextValue | null>(null);

export function SceneProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<SceneTarget | null>(null);
  const open = useCallback((target: SceneTarget) => setCurrent(target), []);
  const close = useCallback(() => setCurrent(null), []);
  return (
    <SceneContext.Provider value={{ current, open, close }}>
      {children}
    </SceneContext.Provider>
  );
}

export function useScene(): SceneContextValue {
  const ctx = useContext(SceneContext);
  if (!ctx) throw new Error("useScene must be used within SceneProvider");
  return ctx;
}
