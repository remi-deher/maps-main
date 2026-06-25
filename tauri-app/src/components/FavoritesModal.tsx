import React, { useState } from "react";
import { Modal } from "./ui/Modal";
import { FavoritesTab } from "./tabs/FavoritesTab";

interface FavoritesModalProps {
  open: boolean;
  onClose: () => void;
}

export const FavoritesModal: React.FC<FavoritesModalProps> = ({ open, onClose }) => {
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3000);
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title="Favoris">
        <FavoritesTab showToast={showToast} />
      </Modal>

      {toast && (
        <div className="toast-overlay" role="status" aria-live="polite">
          <div className="toast">{toast}</div>
        </div>
      )}
    </>
  );
};
