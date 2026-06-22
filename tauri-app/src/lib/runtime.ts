// Runtime detection so the same frontend works both inside the Tauri native
// shell (desktop app, engine spawned as a sidecar) and in a plain browser
// served by the engine's built-in web UI (the headless product).
//
// Tauri v2 always injects __TAURI_INTERNALS__ on window; a plain browser does
// not. Keep this the single source of truth for the "am I in the desktop app?"
// question so the WebSocket URL, sidecar config calls, and log source can each
// branch consistently.
export const isTauri: boolean =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// Same-origin WebSocket URL for browser mode: the engine serves both the page
// and /ws, so we derive the endpoint from the current location (and upgrade to
// wss when the page itself is served over https). In Tauri the webview origin
// is not the engine, so callers use the explicit localhost URL instead.
export function sameOriginWsUrl(path: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${path}`;
}
