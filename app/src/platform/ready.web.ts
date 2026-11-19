/*
 * The web half of ready.ts. markReady() — the splash in public/index.html fades once the fonts are
 *   in.
 *
 * Example: markReady() once the first screen is complete.
 */
export function markReady(): void {
  void document.fonts.ready.then(() => {
    document.documentElement.dataset.mtReady = "1";
  });
}
