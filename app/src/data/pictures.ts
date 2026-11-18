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

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b = 0, c = 0] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    const n = (a << 16) | (b << 8) | c;
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    out += i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? ALPHABET[n & 63] : "=";
  }
  return out;
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
