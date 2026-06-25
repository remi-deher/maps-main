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

// Same-origin HTTP URL for browser mode: used to call the engine's REST surface
// (e.g. /api/pair) from the page it served. In Tauri, the engine is a localhost
// sidecar, so callers target http://localhost:<port> explicitly instead.
export function sameOriginHttpUrl(path: string): string {
  return `${window.location.origin}${path}`;
}

// Durable remote-access token storage. After a remote client pairs once (via the
// rotating QR/code), the engine hands back a "<deviceID>.<secret>" token; we keep
// it in localStorage so every later connection — including after an engine
// restart — reuses it silently, with no re-pairing. Cleared only on explicit
// un-pair or when the engine rejects it.
const TOKEN_KEY = "gpsmock.deviceToken";

export function getStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null; // private mode / storage disabled
  }
}

export function setStoredToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* best effort */
  }
}

export function clearStoredToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* best effort */
  }
}
