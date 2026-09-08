import React from "react";
import { Activity, Cable, Plug, Route, Server, Settings, Smartphone, Wifi } from "lucide-react";
import { Modal } from "./ui/Modal";
import { RemoteAccessSection } from "./RemoteAccessSection";
import { ClusterSection } from "./settings/ClusterSection";
import { ConnectionSection } from "./settings/ConnectionSection";
import { DeviceSection } from "./settings/DeviceSection";
import { DiagnosticsSection } from "./settings/DiagnosticsSection";
import { DriverSection } from "./settings/DriverSection";
import { RoutingSection } from "./settings/RoutingSection";
import { SimulationSection } from "./settings/SimulationSection";
import { useEngine } from "../context/websocket";
import { useSettingsForm } from "../features/settings/useSettingsForm";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

/// Réglages avancés du moteur (connexion, appareil, tunnel/driver, diagnostics),
/// regroupés dans une modale à sections plutôt qu'un onglet permanent de la sidebar.
///
/// Ce fichier n'est plus qu'un assemblage : l'état d'édition vit dans
/// `useSettingsForm`, chaque section dans `components/settings/`, et chacune lit
/// le moteur directement via `useEngine()` au lieu de recevoir une vingtaine de
/// props. Les sections restent ainsi lisibles séparément, et l'état est enfin
/// testable sans monter la modale entière.
export const SettingsModal: React.FC<SettingsModalProps> = ({ open, onClose }) => {
  const { enginePort } = useEngine();
  const form = useSettingsForm(open);

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Réglages"
        sections={[
          { id: "connection", label: "Connexion", icon: Plug, content: <ConnectionSection form={form} /> },
          { id: "device", label: "Appareil", icon: Smartphone, content: <DeviceSection /> },
          { id: "simulation", label: "Simulation", icon: Settings, content: <SimulationSection form={form} /> },
          { id: "driver", label: "Pilote & Tunnel", icon: Cable, content: <DriverSection form={form} /> },
          { id: "routing", label: "Routage", icon: Route, content: <RoutingSection form={form} /> },
          {
            id: "remote",
            label: "Accès distant",
            icon: Wifi,
            content: <RemoteAccessSection enginePort={enginePort} qrPairingHost={form.qrPairingHost} />,
          },
          { id: "cluster", label: "Cluster", icon: Server, content: <ClusterSection form={form} /> },
          { id: "diagnostics", label: "Diagnostics", icon: Activity, content: <DiagnosticsSection form={form} /> },
        ]}
      />

      {form.toast && (
        <div className="toast-overlay" role="status" aria-live="polite">
          <div className="toast">{form.toast}</div>
        </div>
      )}
    </>
  );
};
