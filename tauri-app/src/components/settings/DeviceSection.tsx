import React from "react";
import { RefreshCw } from "lucide-react";
import { useEngine } from "../../context/websocket";

// Read-only identity of the connected iPhone. Purely engine-driven, so it takes
// no form state at all.
export const DeviceSection: React.FC = () => {
  const { canSend, deviceDetails, getDeviceInfo } = useEngine();

  return (
    <div className="ui-card">
      <p style={{ fontSize: "0.8rem", color: "#94a3b8", margin: 0 }}>
        Disponible uniquement avec le driver go-ios pour le moment.
      </p>

      <button className="btn btn-secondary" style={{ marginTop: 8 }} onClick={getDeviceInfo} disabled={!canSend}>
        <RefreshCw size={14} /> Récupérer les infos
      </button>

      {deviceDetails && (
        deviceDetails.error ? (
          <div className="inline-alert" style={{ marginTop: 8 }}>{deviceDetails.error}</div>
        ) : (
          <div className="info-grid" style={{ marginTop: 8 }}>
            <div className="info-item">
              <span className="info-label">Nom</span>
              <span className="info-value compact">{deviceDetails.name || "—"}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Modèle</span>
              <span className="info-value compact">{deviceDetails.productType || "—"}</span>
            </div>
            <div className="info-item">
              <span className="info-label">iOS</span>
              <span className="info-value compact">{deviceDetails.productVersion || "—"}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Numéro de série</span>
              <span className="info-value compact">{deviceDetails.serialNumber || "—"}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Adresse WiFi</span>
              <span className="info-value compact">{deviceDetails.wifiAddress || "—"}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Adresse tunnel</span>
              <span className="info-value compact">{deviceDetails.tunnelAddress || "—"}</span>
            </div>
          </div>
        )
      )}
    </div>
  );
};
