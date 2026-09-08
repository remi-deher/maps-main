import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../../lib/runtime";
import type { EngineTransportContextType, NetworkInterfaceInfo } from "../../types/engine";

type EngineStatusValue = EngineTransportContextType["engineStatus"];

// Everything that only exists when the UI runs inside the Tauri shell: reading
// and writing the sidecar's port and mDNS interface, and following the
// supervisor's lifecycle events.
//
// Served in a browser (the `-tags webui` build), every function here is inert —
// there is no sidecar to supervise, the engine is simply the server that served
// the page. Keeping that split in its own hook is what lets the provider stop
// repeating `if (!isTauri) return;` in four separate effects.
export function useTauriBridge(setLastError: (message: string | null) => void) {
  const [enginePort, setEnginePortState] = useState(8080);
  const [engineStatus, setEngineStatus] = useState<EngineStatusValue>("unknown");
  const [mdnsInterface, setMdnsInterfaceState] = useState<string | null>(null);
  const [networkInterfaces, setNetworkInterfaces] = useState<NetworkInterfaceInfo[]>([]);

  // Initial read of everything the shell owns. Failures are swallowed: a
  // missing command means an older shell, and the defaults above are usable.
  useEffect(() => {
    if (!isTauri) return;
    invoke<number>("get_engine_port")
      .then((port) => setEnginePortState(port))
      .catch(() => {});
    invoke<string | null>("get_mdns_interface")
      .then((iface) => setMdnsInterfaceState(iface))
      .catch(() => {});
    invoke<NetworkInterfaceInfo[]>("list_network_interfaces")
      .then((interfaces) => setNetworkInterfaces(interfaces))
      .catch(() => {});
  }, []);

  // The supervisor's own view of the sidecar process, which the socket state
  // can't provide: a crashed engine and an unreachable one look identical from
  // the WebSocket's side.
  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    listen<string>("engine-status", (event) => {
      const payload = event.payload;
      if (payload === "starting") {
        setEngineStatus("starting");
      } else if (payload.startsWith("restarting")) {
        // "restarting:<attempt>:<max>" — the supervisor is auto-respawning a
        // crashed engine. Show a starting state with a countdown-ish hint.
        setEngineStatus("starting");
        const [, attempt, max] = payload.split(":");
        setLastError(
          attempt && max
            ? `Moteur GPS-Mock interrompu, redémarrage automatique (tentative ${attempt}/${max})…`
            : "Moteur GPS-Mock interrompu, redémarrage automatique…"
        );
      } else if (payload.startsWith("exited") || payload.startsWith("error")) {
        setEngineStatus("crashed");
        setLastError(`Moteur GPS-Mock indisponible (${payload}).`);
      } else {
        setEngineStatus("running");
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unsubscribe = fn;
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  // Both setters restart the sidecar, hence the optimistic "starting".
  const setEnginePort = async (port: number) => {
    if (!isTauri) return;
    setEngineStatus("starting");
    await invoke("set_engine_port", { port });
    setEnginePortState(port);
  };

  const setMdnsInterface = async (interfaceName: string | null) => {
    if (!isTauri) return;
    setEngineStatus("starting");
    await invoke("set_mdns_interface", { interface: interfaceName });
    setMdnsInterfaceState(interfaceName);
  };

  return {
    enginePort,
    setEnginePort,
    engineStatus,
    setEngineStatus,
    mdnsInterface,
    setMdnsInterface,
    networkInterfaces,
  };
}
