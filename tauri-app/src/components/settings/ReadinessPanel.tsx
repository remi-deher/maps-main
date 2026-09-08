import React from "react";
import { AlertTriangle, CheckCircle2, HelpCircle } from "lucide-react";
import type { Readiness, RequirementStatus } from "../../types/engine";

type StatusStyle = { color: string; Icon: React.ComponentType<{ size?: number }>; label: string };

// The icon carries the status for sighted users and its aria-label carries it
// for everyone else — colour alone would encode it for neither.
const STATUS_STYLE: Record<RequirementStatus, StatusStyle> = {
  ok: { color: "#4ade80", Icon: CheckCircle2, label: "conforme" },
  failed: { color: "#f87171", Icon: AlertTriangle, label: "bloquant" },
  unknown: { color: "#94a3b8", Icon: HelpCircle, label: "non vérifié" },
};

// The pre-flight report: which prerequisites for injecting a position are met.
//
// Before this, three of the four failed identically — a 45s tunnel timeout with
// a generic hint — so the operator had to guess which step was missing and wait
// out the timeout to find out they'd guessed wrong. Each line now says what was
// observed and, when there is something to do, what to do.
export const ReadinessPanel: React.FC<{ readiness?: Readiness }> = ({ readiness }) => {
  const requirements = readiness?.requirements ?? [];
  if (requirements.length === 0) return null;

  return (
    <fieldset className="field-group">
      <legend className="field-group-legend">
        Prérequis {readiness?.ready ? "— prêt à injecter" : "— injection impossible en l'état"}
      </legend>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {requirements.map((req) => {
          const { color, Icon, label } = STATUS_STYLE[req.status] ?? STATUS_STYLE.unknown;
          return (
            <div key={req.id} style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
              <span style={{ color, flexShrink: 0, marginTop: "2px" }} role="img" aria-label={label}>
                <Icon size={14} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: "0.82rem", color: "#cbd5e1" }}>{req.label}</div>
                <div style={{ fontSize: "0.76rem", color: "#94a3b8" }}>{req.detail}</div>
                {req.fix && (
                  <div style={{ fontSize: "0.76rem", color, marginTop: "2px" }}>→ {req.fix}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
};
