import type { Page } from "@playwright/test";

// A fake engine, installed in the page before any script runs.
//
// The real engine needs a paired iPhone, a tunnel daemon and a Go build — none
// of which belongs in a UI test. What these tests actually check is the client's
// half of the contract: that the documented {type, data} envelopes reach the
// widgets that display them, and that the app survives the states the engine can
// put it in. So the socket is replaced, and the envelope format is the contract
// under test.
//
// Kept deliberately close to the real thing: the constructor echoes the
// "bearer" subprotocol the engine selects (see engine/internal/server/auth.go),
// because a browser aborts a handshake whose subprotocol isn't echoed back, and
// a stub that ignored that would hide a real regression.

export const STORAGE_TOKEN_KEY = "gpsmock.deviceToken";

// A STATUS payload with the fields the UI reads. Matches api.Status on the
// wire (engine/internal/api/status.go).
export function statusPayload(overrides: Record<string, unknown> = {}) {
  return {
    state: "ready",
    driverId: "go-ios",
    tunnelActive: true,
    connectionType: "usb",
    rsdAddress: "127.0.0.1",
    rsdPort: 54321,
    favorites: [],
    recentHistory: [],
    navigation: {},
    ...overrides,
  };
}

// Installs the stub and, unless `paired` is false, seeds a device token so the
// app starts past the pairing gate.
export async function installEngineStub(page: Page, options: { paired?: boolean } = {}) {
  const { paired = true } = options;

  await page.addInitScript(
    ({ tokenKey, paired, initialStatus }) => {
      if (paired) {
        try {
          window.localStorage.setItem(tokenKey, "e2e-device.e2e-secret");
        } catch {
          /* private mode: the test that needs a token will fail loudly */
        }
      } else {
        try {
          window.localStorage.removeItem(tokenKey);
        } catch {
          /* nothing to clear */
        }
      }

      // Sockets opened so far, so a test can push a frame into the live one.
      const sockets: any[] = [];
      (window as any).__engineStub = {
        sockets,
        // Pushes an envelope to every open socket, as the engine's hub would.
        broadcast(type: string, data: unknown) {
          for (const socket of sockets) {
            socket.onmessage?.({ data: JSON.stringify({ type, data }) });
          }
        },
        // Everything the client has sent, for asserting on outbound actions.
        sent: [] as Array<{ type: string; data: unknown }>,
      };

      class StubWebSocket {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSING = 2;
        static CLOSED = 3;

        url: string;
        protocol: string;
        readyState = 0;
        onopen: (() => void) | null = null;
        onclose: (() => void) | null = null;
        onerror: ((e: unknown) => void) | null = null;
        onmessage: ((e: { data: string }) => void) | null = null;

        constructor(url: string, protocols?: string | string[]) {
          this.url = url;
          // The engine advertises "bearer" and gorilla echoes it; a browser
          // would abort the handshake otherwise.
          this.protocol = Array.isArray(protocols) && protocols[0] === "bearer" ? "bearer" : "";
          sockets.push(this);
          setTimeout(() => {
            this.readyState = 1;
            this.onopen?.();
            this.onmessage?.({ data: JSON.stringify({ type: "STATUS", data: initialStatus }) });
          }, 0);
        }

        send(raw: string) {
          try {
            (window as any).__engineStub.sent.push(JSON.parse(raw));
          } catch {
            /* not our envelope format; ignore */
          }
        }

        close() {
          this.readyState = 3;
          this.onclose?.();
        }

        addEventListener() {}
        removeEventListener() {}
      }

      (window as any).WebSocket = StubWebSocket;
    },
    { tokenKey: STORAGE_TOKEN_KEY, paired, initialStatus: statusPayload() },
  );
}

// Pushes an envelope into the app's live socket.
export async function broadcast(page: Page, type: string, data: unknown) {
  await page.evaluate(
    ({ type, data }) => (window as any).__engineStub.broadcast(type, data),
    { type, data },
  );
}

// Everything the client has sent since load.
export async function sentActions(page: Page): Promise<Array<{ type: string; data: unknown }>> {
  return page.evaluate(() => (window as any).__engineStub.sent);
}
