import React from "react";
import { Modal } from "./ui/Modal";
import { LogsTab } from "./tabs/LogsTab";

interface LogsModalProps {
  open: boolean;
  onClose: () => void;
}

export const LogsModal: React.FC<LogsModalProps> = ({ open, onClose }) => (
  <Modal open={open} onClose={onClose} title="Journaux">
    <LogsTab />
  </Modal>
);
