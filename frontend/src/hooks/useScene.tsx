// The single, app-global 现场 (live agent screen) target. Any avatar anywhere opens the one
// floating viewer through this context; <SceneOverlay> (mounted once) renders it. Keeps 现场
// opening decoupled from any particular page.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
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
  // Opening 现场 is a navigation, not a modal: it pushes a history entry so the browser/phone Back
  // gesture (the app's existing page stack) closes it — with no on-screen back button. `pushed`
  // tracks whether our sentinel entry is still on top so open/close stay balanced across re-opens.
  const pushed = useRef(false);

  const open = useCallback((target: SceneTarget) => {
    if (!pushed.current) {
      window.history.pushState({ __scene: true }, "");
      pushed.current = true;
    }
    setCurrent(target);
  }, []);

  const close = useCallback(() => {
    // Consume our own history entry so Back and Esc leave the stack in the same clean state.
    if (pushed.current) {
      pushed.current = false;
      window.history.back(); // -> popstate -> setCurrent(null)
    } else {
      setCurrent(null);
    }
  }, []);

  // The Back gesture pops our sentinel: react to it by closing (the URL never changed, so the
  // router sees no route change).
  useEffect(() => {
    const onPop = () => {
      pushed.current = false;
      setCurrent(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

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
