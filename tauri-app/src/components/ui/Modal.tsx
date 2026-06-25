import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalSection {
  id: string;
  label: string;
  icon?: React.ComponentType<{ size?: number }>;
  content: React.ReactNode;
}

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  sections?: ModalSection[];
  children?: React.ReactNode;
}

/// Sections nav is only rendered when `sections` is provided; otherwise the
/// modal renders `children` directly in a single full-width pane (Logs,
/// Favorites — no need for sub-navigation).
export const Modal: React.FC<ModalProps> = ({ open, onClose, title, sections, children }) => {
  const [activeSectionId, setActiveSectionId] = useState(sections?.[0]?.id);
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);

  // Reset to the first tab only on an actual closed->open transition (tracked
  // via `wasOpen`, not the `open` prop's identity alone). `sections` is
  // intentionally excluded from the deps: SettingsModal rebuilds that array
  // (new reference) on every re-render — e.g. periodic status polling every
  // ~5s — which was bouncing the user back to "Connexion" while the modal
  // stayed open the whole time.
  useEffect(() => {
    if (open && !wasOpen.current) setActiveSectionId(sections?.[0]?.id);
    wasOpen.current = open;
  }, [open]);

  // Focus trap: move focus into the modal on open, cycle Tab/Shift+Tab within
  // it, and give focus back to whatever triggered the modal on close — Tab
  // otherwise escapes to the map/sidebar behind the overlay.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const focusables = () =>
      Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []);

    const first = focusables()[0];
    (first ?? panelRef.current)?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const items = focusables();
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];

      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocused.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  const activeSection = sections && (sections.find((s) => s.id === activeSectionId) ?? sections[0]);

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="modal-panel" ref={panelRef} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>
        </header>

        {sections ? (
          <div className="modal-body">
            <nav className="modal-sections-nav" aria-label="Sections">
              {sections.map((section) => {
                const Icon = section.icon;
                return (
                  <button
                    key={section.id}
                    className={`modal-section-btn ${activeSection?.id === section.id ? "active" : ""}`}
                    onClick={() => setActiveSectionId(section.id)}
                    type="button"
                  >
                    {Icon && <Icon size={16} />}
                    {section.label}
                  </button>
                );
              })}
            </nav>

            <div className="modal-section-content">{activeSection?.content}</div>
          </div>
        ) : (
          <div className="modal-body modal-body-simple">
            <div className="modal-section-content">{children}</div>
          </div>
        )}
      </div>
    </div>
  );
};
