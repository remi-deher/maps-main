import React, { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { RefreshCw, Trash2, Wifi } from "lucide-react";
import { isTauri } from "../lib/runtime";
import { useEngine } from "../context/websocket";
import { usePairing } from "../context/pairingContext";

interface RemoteAccessSectionProps {
  // Engine sidecar port (loopback), used to build the QR target URL.
  enginePort: number;
  // LAN host other machines use to reach this engine (null when no usable
  // interface was detected — e.g. offline), used to build the QR target URL.
  qrPairingHost: string | null;
}

// RemoteAccessSection lets the desktop user authorize another machine's browser
// to control this engine. It shows the rotating pairing code (and a QR that
// deep-links a remote browser straight into auto-pairing), plus the list of
// already-paired devices with a revoke action.
//
// Everything goes over the engine's loopback WebSocket (via the shared context),
// not a REST fetch: the Tauri webview's origin is tauri://localhost, so a fetch
// to http://localhost:<port> is cross-origin and blocked by CORS — but the
// WebSocket the app already uses isn't. The engine answers these actions only
// for loopback clients, so this stays desktop-only.
export const RemoteAccessSection: React.FC<RemoteAccessSectionProps> = ({ enginePort, qrPairingHost }) => {
  const { isConnected } = useEngine();
      const { remotePairCode, pairedDevices, requestPairCode, requestPairedDevices, revokePairedDevice } = usePairing();
  const [secondsLeft, setSecondsLeft] = useState(30);

  // Once connected, ask for the current code and device list, then keep the
  // code fresh: tick the countdown down and re-request when the window rolls
  // over so the displayed code is always currently valid.
  useEffect(() => {
    if (!isTauri || !isConnected) return;
    requestPairCode();
    requestPairedDevices();
    const timer = window.setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          requestPairCode();
          return 30;
        }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected]);

  // Resync the countdown whenever a fresh code arrives from the engine.
  useEffect(() => {
    if (remotePairCode) setSecondsLeft(remotePairCode.secondsRemaining);
  }, [remotePairCode]);

  if (!isTauri) {
    return (
      <div className="ui-card">
        <p style={{ fontSize: "0.85rem", color: "#94a3b8", margin: 0 }}>
          La gestion de l'accès distant n'est disponible que depuis l'application de bureau.
        </p>
      </div>
    );
  }

  const code = remotePairCode?.code ?? null;
  // The QR encodes the engine origin plus the rotating code, so scanning opens
  // the remote browser directly into the (auto-submitting) pairing flow.
  const qrValue = qrPairingHost && code ? `http://${qrPairingHost}:${enginePort}/?pair=${code}` : null;
  const remoteUrl = qrPairingHost ? `http://${qrPairingHost}:${enginePort}/` : null;

  return (
    <div className="ui-card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <p style={{ fontSize: "0.85rem", color: "#94a3b8", margin: "0 0 8px" }}>
          Contrôlez ce moteur depuis le navigateur d'un autre ordinateur. Sur l'autre machine,
          ouvrez l'adresse ci-dessous puis saisissez le code — ou scannez le QR Code pour vous
          connecter directement.
        </p>
        {remoteUrl ? (
          <code style={{ fontSize: "0.9rem", wordBreak: "break-all" }}>{remoteUrl}</code>
        ) : (
          <div className="inline-alert">
            <Wifi size={14} /> Connectez une interface réseau (Wi-Fi/Ethernet) pour activer l'accès distant.
          </div>
        )}
      </div>

      {!isConnected && (
        <div className="inline-alert">Moteur hors ligne — le code apparaîtra une fois connecté.</div>
      )}

      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: "2.4rem",
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "0.25em",
              fontWeight: 600,
            }}
          >
            {code ?? "——————"}
          </div>
          <div style={{ fontSize: "0.72rem", color: "#94a3b8" }}>
            {code ? `Nouveau code dans ${secondsLeft}s` : "…"}
          </div>
        </div>
        {qrValue && (
          <div style={{ background: "#fff", padding: 8, borderRadius: 8 }}>
            <QRCodeSVG value={qrValue} size={132} />
          </div>
        )}
      </div>

      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span className="ui-card-title" style={{ margin: 0 }}>
            Appareils autorisés ({pairedDevices.length})
          </span>
          <button className="btn btn-secondary btn-sm" onClick={requestPairedDevices} disabled={!isConnected}>
            <RefreshCw size={13} /> Actualiser
          </button>
        </div>
        {pairedDevices.length === 0 ? (
          <p style={{ fontSize: "0.78rem", color: "#94a3b8", marginTop: 8 }}>
            Aucun appareil appairé pour l'instant.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "flex", flexDirection: "column", gap: 6 }}>
            {pairedDevices.map((d) => (
              <li
                key={d.id}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}
              >
                <span style={{ fontSize: "0.8rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {d.label || d.id.slice(0, 8)}
                  <span style={{ color: "#64748b", marginLeft: 6 }}>
                    · vu {d.lastSeen ? new Date(d.lastSeen * 1000).toLocaleString() : "—"}
                  </span>
                </span>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => revokePairedDevice(d.id)}
                  title="Révoquer"
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
