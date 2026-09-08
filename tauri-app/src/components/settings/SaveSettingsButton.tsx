import React from "react";
import { Save } from "lucide-react";
import { useEngine } from "../../context/websocket";

// The "Enregistrer" button that closes the Simulation, Routage and Cluster
// sections. All three push the same full payload (buildSettingsPayload sends
// every field, not just the section's own), so they were three copies of the
// same markup and the same disabled condition.
export const SaveSettingsButton: React.FC<{ onSave: () => void }> = ({ onSave }) => {
  const { canSend } = useEngine();
  return (
    <button className="btn" onClick={onSave} style={{ marginTop: "10px" }} disabled={!canSend}>
      <Save size={14} /> Enregistrer
    </button>
  );
};
