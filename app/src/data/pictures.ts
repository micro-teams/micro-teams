/*
 * Pictures from the origin — avatars — fetched over the substrate like everything else, rather
 * than by the image component straight from the origin.
 *
 * usePicture(path) → a uri an <Image> can show, or null while it loads (or when it failed). path is
 *   origin-relative ("/api/avatars/12"). Each picture is fetched once per session and shared by
 *   every face showing it.
 * pictureUri(bytes, type) — what the bytes become: an object URL in a browser, a data URI on a
 *   phone (React Native's Blob cannot be built from bytes).
 *
 * Example: const uri = usePicture(`/api/avatars/${avatarId}`);
 */
import { useEffect, useState } from "react";
import { isWeb } from "../platform/platform";
import { useSession } from "./session";

const cache = new Map<string, Promise<string | null>>();

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
  if (isWeb) return URL.createObjectURL(new Blob([bytes], { type }));
  return `data:${type};base64,${base64(new Uint8Array(bytes))}`;
}

export function usePicture(path: string | null): string | null {
  const { origin, substrate } = useSession();
  const key = path ? `${origin}${path}` : null;
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    if (!key) return;
    let alive = true;
    let pending = cache.get(key);
    if (!pending) {
      pending = substrate.fetch(key).then(
        async (res) => (res.ok ? pictureUri(await res.arrayBuffer(), res.headers.get("Content-Type") ?? "image/png") : null),
        () => null,
      );
      // A failure is not remembered: the next face to ask tries again.
      void pending.then((u) => u === null && cache.delete(key));
      cache.set(key, pending);
    }
    void pending.then((u) => alive && setUri(u));
    return () => {
      alive = false;
    };
  }, [key, substrate]);
  return key ? uri : null;
}
