import React from "react";
import { Smartphone } from "lucide-react";
import { useWebSocket } from "../context/websocket";
import { Modal } from "./ui/Modal";

interface DeviceModalProps {
  open: boolean;
  onClose: () => void;
}

/// Device status, moved out of the always-on floating frame and into an
/// on-demand modal — the map was getting cluttered with permanently visible
/// panels that aren't needed at a glance.
export const DeviceModal: React.FC<DeviceModalProps> = ({ open, onClose }) => {
  const { status } = useWebSocket();

  return (
    <Modal open={open} onClose={onClose} title="Périphérique">
      <div className="ui-card">
        <div className="command-panel-header">
          <div>
            <span className="section-kicker">Device</span>
            <h2>
              <Smartphone size={17} /> Périphérique
            </h2>
          </div>
          <span className="state-pill">{status?.deviceInfo ? "détecté" : "aucun"}</span>
        </div>
        {status?.deviceInfo ? (
          <div className="field-row-list">
            <div><span>Nom</span><strong>{status.deviceInfo.name}</strong></div>
            <div><span>Driver</span><strong>{status.deviceInfo.driver}</strong></div>
            <div><span>Transport</span><strong>{status.connectionType}</strong></div>
          </div>
        ) : (
          <div className="empty-state compact">Aucun appareil connecté.</div>
        )}
      </div>
    </Modal>
  );
};
