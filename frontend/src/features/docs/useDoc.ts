// One open document: what it says, whether it is saved, and every rule about the two disagreeing.
//
// This is the whole of "editing a document" — loading, seeding local state without clobbering the
// user's edits, revalidating when the tab comes back, debounced autosave, explicit save, and
// dropping the ?new flag once the file exists. The phone and the desktop differ in where the
// textarea and the preview sit, and in nothing else, so nothing else lives in their files.
//
// It used to live twice, and the two copies had already drifted: the desktop autosaved 1.2s after
// the last keystroke and the phone did not, so the surface most likely to be backgrounded or
// reclaimed by the OS was the one that required an explicit tap. That is the class of bug this
// arrangement is meant to make impossible — a capability now exists once, for both.
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { DocNode } from "@/api";
import { mtCall, teamApi } from "@/lib/mtApi";
import { errMsg } from "@/hooks/useAsync";

/** 1.2s after the last keystroke. Long enough not to fight typing, short enough to survive a swipe-away. */
const AUTOSAVE_MS = 1200;

export interface OpenDoc {
  content: string;
  setContent: (next: string) => void;
  /** True while the buffer differs from what the server last acknowledged. */
  dirty: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  /** Whether anything is on screen yet (loaded, or a brand-new empty file). */
  ready: boolean;
  save: () => Promise<void>;
}

export function useDoc({
  teamId,
  path,
  isNew,
}: {
  teamId: number;
  path: string;
  isNew: boolean;
}): OpenDoc {
  const navigate = useNavigate();
  const [content, setContent] = useState("");
  // What the server last confirmed. null means "not loaded yet", which is why it is not just a
  // string: it is the difference between "empty document" and "nothing known", and the seeding
  // rule below turns on exactly that distinction.
  const [savedContent, setSavedContent] = useState<string | null>(
    isNew ? "" : null,
  );
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = savedContent !== null && content !== savedContent;
  // Read live by the revalidate listener, which would otherwise capture a stale `dirty` and
  // overwrite edits made after it was registered.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Load once per (team, path). A brand-new file starts empty and asks the server nothing.
  useEffect(() => {
    let active = true;
    if (isNew) {
      setContent("");
      setSavedContent("");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setSavedContent(null);
    mtCall(teamApi().getDocument({ id: teamId, path, content: true }))
      .then((node: DocNode) => {
        if (!active) return;
        setContent(node.content ?? "");
        setSavedContent(node.content ?? "");
      })
      .catch((err: unknown) => active && setError(errMsg(err)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [teamId, path, isNew]);

  // A document open in a tab goes stale the moment a teammate (or an agent's `docs sync`) writes a
  // newer version. Refetch when the tab becomes visible or the window regains focus, and adopt the
  // answer only when there is nothing unsaved — never interrupt someone mid-edit. (T-053)
  useEffect(() => {
    if (isNew) return;
    let active = true;
    function revalidate() {
      if (document.visibilityState !== "visible" || dirtyRef.current) return;
      mtCall(teamApi().getDocument({ id: teamId, path, content: true }))
        .then((node: DocNode) => {
          if (!active || dirtyRef.current) return;
          setContent(node.content ?? "");
          setSavedContent(node.content ?? "");
        })
        .catch(() => {
          // A failed background refresh keeps showing what we have — it is not an error the
          // reader can act on, and an alert here would interrupt reading for nothing.
        });
    }
    document.addEventListener("visibilitychange", revalidate);
    window.addEventListener("focus", revalidate);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", revalidate);
      window.removeEventListener("focus", revalidate);
    };
  }, [teamId, path, isNew]);

  const saveBody = useCallback(
    async (body: string) => {
      setError(null);
      setSaving(true);
      try {
        await mtCall(teamApi().writeDocument({ id: teamId, path, body }));
        setSavedContent(body);
        if (isNew) {
          // Drop the ?new flag so a reload reads the now-existing file.
          navigate(`/teams/${teamId}/file?path=${encodeURIComponent(path)}`, {
            replace: true,
          });
        }
      } catch (err) {
        setError(errMsg(err));
      } finally {
        setSaving(false);
      }
    },
    [teamId, path, isNew, navigate],
  );

  // Debounced autosave. Guarded on savedContent !== null so it can never fire before the load
  // lands and write an empty buffer over a real file.
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (savedContent === null || content === savedContent) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(
      () => void saveBody(content),
      AUTOSAVE_MS,
    );
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [content, savedContent, saveBody]);

  const save = useCallback(() => saveBody(content), [saveBody, content]);

  return {
    content,
    setContent,
    dirty,
    loading,
    saving,
    error,
    ready: isNew || savedContent !== null,
    save,
  };
}
