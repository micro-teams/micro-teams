/*
 * The web half of worker.ts: registers sw.js under the app's base URL. Skipped in development,
 * where the bundle is served by Metro and a worker caching it would serve yesterday's code.
 */
export function registerWorker(): void {
  if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
  const base = `${process.env.EXPO_BASE_URL ?? ""}/`;
  navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).then(
    (r) => console.log(`sw: registered for ${r.scope}`),
    (e: unknown) => console.warn(`sw: could not register: ${String(e)}`),
  );
}
