import React, { useEffect, useState } from "react";
import { Play, ShieldCheck, Square, Search, MousePointerClick, Circle, Square as SquareIcon, X } from "lucide-react";
import { useWebSocket, LatLon } from "../context/websocket";
import { reverseGeocode } from "../lib/geocoding";
import { DestinationSearchInput } from "./DestinationSearchInput";

interface PatrolModePanelProps {
  patrolCenter: LatLon | null;
  setPatrolCenter: (center: LatLon | null) => void;
}

/// Compact icon-toggle row (shared visual with RouteModePanel's segmented
/// controls).
const SegmentedToggle: React.FC<{
  options: Array<{ id: string; label: string; icon: React.ComponentType<{ size?: number }> }>;
  value: string;
  onChange: (id: string) => void;
}> = ({ options, value, onChange }) => (
  <div className="mode-toggle" role="group">
    {options.map((opt) => {
      const Icon = opt.icon;
      return (
        <button
          key={opt.id}
          type="button"
          className={`mode-toggle-btn ${value === opt.id ? "active" : ""}`}
          aria-pressed={value === opt.id}
          title={opt.label}
          onClick={() => onChange(opt.id)}
        >
          <Icon size={16} />
          <span>{opt.label}</span>
        </button>
      );
    })}
  </div>
);

/// Unified patrol-zone builder — the center is set by search OR map click
/// (one block, not just click), then zone type / radius / launch follow.
/// `patrolCenter` is shared with the parent InteractiveMap for the live preview.
export const PatrolModePanel: React.FC<PatrolModePanelProps> = ({ patrolCenter, setPatrolCenter }) => {
  const { canSend, status, updatePatrolZone } = useWebSocket();

  const [centerMethod, setCenterMethod] = useState<"search" | "map">("search");
  const [patrolType, setPatrolType] = useState<"circle" | "rectangle">("circle");
  const [patrolRadius, setPatrolRadius] = useState("200");
  // Remembers the geocoded name only while the center still matches what was
  // searched — a later map click changes the coords and falls back to them.
  const [searched, setSearched] = useState<{ lat: number; lon: number; name: string } | null>(null);

  const isActive = status?.patrolZone?.active ?? false;

  // When the center is set by a map click (not search), look up the nearest
  // place so the chip shows a name instead of raw coordinates.
  useEffect(() => {
    if (!patrolCenter) return;
    if (searched && searched.lat === patrolCenter.lat && searched.lon === patrolCenter.lon) return;
    const { lat, lon } = patrolCenter;
    let cancelled = false;
    reverseGeocode(lat, lon).then((name) => {
      if (!cancelled && name) setSearched({ lat, lon, name });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patrolCenter?.lat, patrolCenter?.lon]);

  const centerLabel = patrolCenter
    ? searched && searched.lat === patrolCenter.lat && searched.lon === patrolCenter.lon
      ? searched.name
      : `${patrolCenter.lat.toFixed(5)}, ${patrolCenter.lon.toFixed(5)}`
    : null;

  const startPatrol = () => {
    if (!patrolCenter) return;
    updatePatrolZone({
      type: patrolType,
      center: patrolCenter,
      radius: parseFloat(patrolRadius) || 200,
      active: true,
    });
    // The server-rendered zone (status.patrolZone) takes over once active.
    setPatrolCenter(null);
    setSearched(null);
  };

  const stopPatrol = () => {
    updatePatrolZone({
      type: patrolType,
      center: patrolCenter ?? status?.patrolZone?.center ?? { lat: 0, lon: 0 },
      radius: parseFloat(patrolRadius) || 200,
      active: false,
    });
  };

  return (
    <div className="map-tool-content">
      <div className="ui-card">
        <h3 className="ui-card-title">
          <ShieldCheck size={16} /> Zone de patrouille
        </h3>

        {/* Center, shown as a chip once set */}
        {centerLabel ? (
          <div className="waypoint-item">
            <span className="waypoint-badge">
              <ShieldCheck size={12} />
            </span>
            <span className="waypoint-name">{centerLabel}</span>
            <button
              className="icon-btn"
              onClick={() => {
                setPatrolCenter(null);
                setSearched(null);
              }}
              aria-label="Effacer le centre"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <p className="form-hint" style={{ margin: 0 }}>
            Définissez le centre de la zone par recherche ou en cliquant sur la carte.
          </p>
        )}

        {/* How to set the center */}
        <div className="form-group">
          <label className="form-label">Définir le centre</label>
          <SegmentedToggle
            value={centerMethod}
            onChange={(v) => setCenterMethod(v as "search" | "map")}
            options={[
              { id: "search", label: "Rechercher", icon: Search },
              { id: "map", label: "Sur la carte", icon: MousePointerClick },
            ]}
          />
        </div>

        {centerMethod === "search" ? (
          <DestinationSearchInput
            placeholder="Rechercher un lieu..."
            near={patrolCenter ?? status?.patrolZone?.center ?? undefined}
            onSelect={(lat, lon, name) => {
              setPatrolCenter({ lat, lon });
              setSearched({ lat, lon, name });
            }}
          />
        ) : (
          <p className="form-hint" style={{ margin: 0 }}>
            Cliquez sur la carte pour positionner le centre de la zone.
          </p>
        )}

        <div className="form-group">
          <label className="form-label">Type de zone</label>
          <SegmentedToggle
            value={patrolType}
            onChange={(v) => setPatrolType(v as "circle" | "rectangle")}
            options={[
              { id: "circle", label: "Cercle", icon: Circle },
              { id: "rectangle", label: "Rectangle", icon: SquareIcon },
            ]}
          />
        </div>

        {patrolType === "circle" && (
          <div className="form-group">
            <label className="form-label">Rayon (m)</label>
            <input type="number" value={patrolRadius} onChange={(e) => setPatrolRadius(e.target.value)} />
          </div>
        )}

        {isActive ? (
          <button className="btn btn-danger" disabled={!canSend} onClick={stopPatrol}>
            <Square size={14} /> Arrêter patrouille
          </button>
        ) : (
          <button className="btn btn-success" disabled={!canSend || !patrolCenter} onClick={startPatrol}>
            <Play size={14} /> Lancer patrouille
          </button>
        )}
      </div>
    </div>
  );
};
