/* The web half of ready.ts: the splash in public/index.html fades once the fonts are in. */
export function markReady(): void {
  void document.fonts.ready.then(() => {
    document.documentElement.dataset.mtReady = "1";
  });
}
