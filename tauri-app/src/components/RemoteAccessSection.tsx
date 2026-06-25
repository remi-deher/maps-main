import React, { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { RefreshCw, Trash2, Wifi } from "lucide-react";
import { isTauri } from "../lib/runtime";

interface PairedDevice {
  id: string;
  label: string;
  createdAt: number;
  lastSeen: number;
}

interface RemoteAccessSectionProps {
  // Engine sidecar port (loopback) used to reach the pairing API from the
  // trusted desktop window.
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
// All requests go to the engine over loopback (the pairing-code and device
// endpoints are loopback-only on the server), so this is desktop-only.
export const RemoteAccessSection: React.FC<RemoteAccessSectionProps> = ({ enginePort, qrPairingHost }) => {
  const base = `http://localhost:${enginePort}`;
  const [code, setCode] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(30);
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refreshCode = useCallback(async () => {
    try {
      const resp = await fetch(`${base}/api/pair/code`);
      if (!resp.ok) throw new Error(String(resp.status));
      const data = (await resp.json()) as { code: string; secondsRemaining: number };
      setCode(data.code);
      setSecondsLeft(data.secondsRemaining);
      setError(null);
    } catch {
      setError("Impossible de récupérer le code (moteur hors ligne ?).");
      setCode(null);
    }
  }, [base]);

  const refreshDevices = useCallback(async () => {
    try {
      const resp = await fetch(`${base}/api/pair/devices`);
      if (!resp.ok) throw new Error(String(resp.status));
      setDevices((await resp.json()) as PairedDevice[]);
    } catch {
      /* non-fatal: leave the previous list */
    }
  }, [base]);

  const revoke = async (id: string) => {
    try {
      await fetch(`${base}/api/pair/devices/${id}`, { method: "DELETE" });
      await refreshDevices();
    } catch {
      setError("Échec de la révocation.");
    }
  };

  // Initial load + tick down the countdown, refetching the code when the window
  // rolls over (so the displayed code is always currently valid).
  useEffect(() => {
    if (!isTauri) return;
    void refreshCode();
    void refreshDevices();
    const timer = window.setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          void refreshCode();
          return 30;
        }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [refreshCode, refreshDevices]);

  if (!isTauri) {
    return (
      <div className="ui-card">
        <p style={{ fontSize: "0.85rem", color: "#94a3b8", margin: 0 }}>
          La gestion de l'accès distant n'est disponible que depuis l'application de bureau.
        </p>
      </div>
    );
  }

  // The QR encodes the engine origin plus the rotating code, so scanning opens
  // the remote browser directly into the (auto-submitting) pairing flow.
  const qrValue =
    qrPairingHost && code ? `http://${qrPairingHost}:${enginePort}/?pair=${code}` : null;
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

      {error && <div className="inline-alert">{error}</div>}

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
            Nouveau code dans {secondsLeft}s
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
            Appareils autorisés ({devices.length})
          </span>
          <button className="btn btn-secondary btn-sm" onClick={() => void refreshDevices()}>
            <RefreshCw size={13} /> Actualiser
          </button>
        </div>
        {devices.length === 0 ? (
          <p style={{ fontSize: "0.78rem", color: "#94a3b8", marginTop: 8 }}>
            Aucun appareil appairé pour l'instant.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "flex", flexDirection: "column", gap: 6 }}>
            {devices.map((d) => (
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
                <button className="btn btn-danger btn-sm" onClick={() => void revoke(d.id)} title="Révoquer">
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
