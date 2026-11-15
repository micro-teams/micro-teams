/*
 * Registering the service worker — a web thing; on a phone there is nothing to register.
 *
 * registerWorker() — on the web, registers sw.js from where the app is served (scope: the app);
 *   elsewhere does nothing. Failure is logged, never thrown: the app works without its worker, it
 *   only loses the offline copy and the substrate under the browser's own fetches.
 *
 * Example: registerWorker();  // once, at start
 */
export function registerWorker(): void {}
