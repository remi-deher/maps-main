import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Download, RotateCcw, CheckCircle2, AlertTriangle } from "lucide-react";
import { isTauri } from "../lib/runtime";
import { useWebSocket } from "../context/websocket";

// EngineRelease mirrors the Rust updater::EngineRelease struct returned by the
// engine_check_update command.
interface EngineRelease {
  tag: string;
  name: string;
  assetUrl: string;
  assetName: string;
  sha256: string;
}

// Loose "is the latest tag newer than what's running?" check. Versions are
// "vX.Y.Z" tags vs the engine's reported version ("X.Y.Z" or "dev"). A dev
// build always offers the update; otherwise compare numeric components.
function isNewer(latestTag: string, current: string): boolean {
  if (!current || current === "dev") return true;
  const norm = (s: string) => s.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const [a, b] = [norm(latestTag), norm(current)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

// UpdatesSection updates only the Go engine binary — the component that changes
// most often — without re-downloading the whole installer (drivers, Python,
// shell). The new binary lands in a writable app-data override the engine
// prefers on next launch, so no admin rights and a one-click revert. Shell/UI
// updates still go through the full installer (a separate, signed mechanism).
export const UpdatesSection: React.FC = () => {
  const { status, engineStatus } = useWebSocket();
  const current = status?.envInfo?.version ?? "—";
  const [latest, setLatest] = useState<EngineRelease | null>(null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [usingOverride, setUsingOverride] = useState(false);

  React.useEffect(() => {
    if (!isTauri) return;
    invoke<boolean>("engine_using_override").then(setUsingOverride).catch(() => {});
  }, []);

  if (!isTauri) {
    return (
      <div className="ui-card">
        <p style={{ fontSize: "0.85rem", color: "#94a3b8", margin: 0 }}>
          Les mises à jour ne sont gérées que depuis l'application de bureau.
        </p>
      </div>
    );
  }

  const check = async () => {
    setChecking(true);
    setError(null);
    setDone(null);
    try {
      const rel = await invoke<EngineRelease>("engine_check_update");
      setLatest(rel);
    } catch (e) {
      setError(String(e));
    } finally {
      setChecking(false);
    }
  };

  const apply = async () => {
    setApplying(true);
    setError(null);
    try {
      const tag = await invoke<string>("engine_apply_update");
      setDone(`Moteur mis à jour vers ${tag}. Redémarrage en cours…`);
      setUsingOverride(true);
      setLatest(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setApplying(false);
    }
  };

  const revert = async () => {
    setApplying(true);
    setError(null);
    try {
      await invoke("engine_clear_update");
      setUsingOverride(false);
      setDone("Retour au moteur d'origine. Redémarrage en cours…");
    } catch (e) {
      setError(String(e));
    } finally {
      setApplying(false);
    }
  };

  const updateAvailable = latest && isNewer(latest.tag, current);

  return (
    <div className="ui-card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p style={{ fontSize: "0.85rem", color: "#94a3b8", margin: 0 }}>
        Met à jour uniquement le moteur (le composant qui évolue le plus souvent), sans
        retélécharger l'installeur complet ni les pilotes. La mise à jour est réversible.
      </p>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: "0.85rem" }}>
        <div>
          <div style={{ color: "#64748b", fontSize: "0.72rem" }}>Version du moteur</div>
          <div style={{ fontWeight: 600 }}>
            {current}
            {usingOverride && (
              <span style={{ color: "#94a3b8", fontWeight: 400, marginLeft: 6 }}>(mise à jour)</span>
            )}
          </div>
        </div>
        {latest && (
          <div>
            <div style={{ color: "#64748b", fontSize: "0.72rem" }}>Dernière version</div>
            <div style={{ fontWeight: 600 }}>{latest.tag}</div>
          </div>
        )}
      </div>

      {error && (
        <div className="inline-alert">
          <AlertTriangle size={14} /> {error}
        </div>
      )}
      {done && (
        <div className="inline-alert" style={{ color: "#34d399" }}>
          <CheckCircle2 size={14} /> {done}
        </div>
      )}
      {latest && !updateAvailable && !done && (
        <div className="inline-alert" style={{ color: "#34d399" }}>
          <CheckCircle2 size={14} /> Le moteur est à jour.
        </div>
      )}
      {latest && updateAvailable && latest.sha256 === "" && (
        <div className="inline-alert">
          <AlertTriangle size={14} /> Aucun checksum publié pour cette version — intégrité non vérifiable.
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn btn-secondary btn-sm" onClick={check} disabled={checking || applying}>
          <Download size={13} /> {checking ? "Vérification…" : "Vérifier les mises à jour"}
        </button>
        {updateAvailable && (
          <button className="btn btn-sm" onClick={apply} disabled={applying}>
            <Download size={13} /> {applying ? "Installation…" : `Installer ${latest.tag}`}
          </button>
        )}
        {usingOverride && (
          <button className="btn btn-secondary btn-sm" onClick={revert} disabled={applying}>
            <RotateCcw size={13} /> Revenir au moteur d'origine
          </button>
        )}
      </div>

      {engineStatus === "starting" && (
        <p style={{ fontSize: "0.72rem", color: "#94a3b8", margin: 0 }}>Redémarrage du moteur…</p>
      )}
    </div>
  );
};
