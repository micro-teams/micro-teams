/*
 * Small values that must survive the app being killed, readable synchronously so the first frame
 * can use them: the chosen server, the session, the outbox, the line list.
 *
 * storage.get(key) / storage.set(key, value) / storage.remove(key) — strings.
 * storage.getJson<T>(key) / storage.setJson(key, value) — objects; a stored value that is not valid
 *   JSON reads as null.
 *
 * Example: storage.setJson("session", s); const s = storage.getJson<Session>("session");
 *
 * MMKV on a phone, localStorage on the web: react-native-mmkv implements its web build on it.
 */
import { createMMKV } from "react-native-mmkv";

const mmkv = createMMKV({ id: "microteams" });

export const storage = {
  get: (key: string): string | null => mmkv.getString(key) ?? null,
  set: (key: string, value: string) => mmkv.set(key, value),
  remove: (key: string) => {
    mmkv.remove(key);
  },
  getJson<T>(key: string): T | null {
    const raw = mmkv.getString(key);
    if (raw === undefined) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
  setJson: (key: string, value: unknown) => mmkv.set(key, JSON.stringify(value)),
};
