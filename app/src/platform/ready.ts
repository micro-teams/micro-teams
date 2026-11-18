/*
 * Telling the page the app has drawn its first complete screen.
 *
 * markReady() — on the web, waits for the page's fonts and then lets public/index.html's splash
 *   fade; on a phone there is no page splash to lift, so it does nothing.
 *
 * Example: useEffect(() => { if (ready) markReady(); }, [ready]);
 */
export function markReady(): void {}
