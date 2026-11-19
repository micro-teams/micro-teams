/*
 * Pictures from the origin — avatars — fetched over the substrate like everything else, rather
 * than by the image component straight from the origin, and kept on the device.
 *
 * usePicture(path) → a uri an <Image> can show, or null while it loads (or when it failed). path is
 *   origin-relative ("/api/avatars/12"). A picture already on the device is there from the first
 *   frame, on every launch: an avatar's address names one picture forever (a new one gets a new
 *   id), so a kept copy is never stale and is never asked for again. Each picture is fetched at
 *   most once per session, and shared by every face showing it.
 * pictureUri(bytes, type) — what the bytes become: a data URI, the one form an <Image> shows on
 *   every platform and that can be kept as a string.
 *
 * Example: const uri = usePicture(`/api/avatars/${avatarId}`);
 *
 * Kept in storage, the most recently shown first, up to KEEP characters in all; a picture larger
 * than ONE is shown but not kept, so one large picture cannot push every face out.
 */
import { useEffect, useState } from "react";
import { storage } from "../platform/storage";
import { useSession } from "./session";

const KEEP = 3_000_000;
const ONE = 300_000;
const INDEX = "pictures";

const shown = new Map<string, string>();
const fetching = new Map<string, Promise<string | null>>();

/**
 * The engine's own btoa over the bytes as a binary string, built a chunk at a time: encoding in a
 * loop of JavaScript string operations is slow enough per picture to stall a list being flung
 * while new faces come into view.
 */
function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function pictureUri(bytes: ArrayBuffer, type: string): string {
  return `data:${type};base64,${base64(new Uint8Array(bytes))}`;
}

/** What is on the device for this key, read synchronously. */
function known(key: string): string | null {
  const held = shown.get(key);
  if (held) return held;
  const kept = storage.get(`picture:${key}`);
  if (kept) shown.set(key, kept);
  return kept;
}

function keep(key: string, uri: string) {
  shown.set(key, uri);
  if (uri.length > ONE) return;
  const index = (storage.getJson<{ key: string; size: number }[]>(INDEX) ?? []).filter((e) => e.key !== key);
  index.unshift({ key, size: uri.length });
  let total = 0;
  const kept = index.filter((e) => (total += e.size) <= KEEP);
  for (const e of index.slice(kept.length)) storage.remove(`picture:${e.key}`);
  storage.set(`picture:${key}`, uri);
  storage.setJson(INDEX, kept);
}

export function usePicture(path: string | null): string | null {
  const { origin, substrate } = useSession();
  const key = path ? `${origin}${path}` : null;
  const ready = key ? known(key) : null;
  const [fetched, setFetched] = useState<{ key: string; uri: string } | null>(null);
  useEffect(() => {
    if (!key || known(key)) return;
    let alive = true;
    let pending = fetching.get(key);
    if (!pending) {
      pending = substrate.fetch(key).then(
        async (res) => (res.ok ? pictureUri(await res.arrayBuffer(), res.headers.get("Content-Type") ?? "image/png") : null),
        () => null,
      );
      fetching.set(key, pending);
      // A failure is not remembered: the next face to ask tries again.
      void pending.then((uri) => {
        fetching.delete(key);
        if (uri) keep(key, uri);
      });
    }
    void pending.then((uri) => alive && uri && setFetched({ key, uri }));
    return () => {
      alive = false;
    };
  }, [key, substrate]);
  return ready ?? (fetched && fetched.key === key ? fetched.uri : null);
}
