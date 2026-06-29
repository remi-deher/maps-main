import React, { useEffect, useRef, useState } from "react";
import { usePairing } from "../context/pairingContext";

// PairingGate is shown (browser mode only) when a remote client has no durable
// token yet. The user enters the 6-digit code displayed in the desktop app —
// or, when the QR was scanned, the code arrives pre-filled and is submitted
// automatically. After a successful exchange the gate disappears and the normal
// WebSocket connection takes over.
export const PairingGate: React.FC = () => {
  const { needsPairing, submitCode, pairCodeError, prefillCode } = usePairing();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const autoSubmitted = useRef(false);

  // Pre-fill (and auto-submit once) when the code came from a scanned QR link.
  useEffect(() => {
    if (prefillCode) {
      setCode(prefillCode);
    }
  }, [prefillCode]);

  useEffect(() => {
    if (prefillCode && !autoSubmitted.current) {
      autoSubmitted.current = true;
      void handleSubmit(prefillCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillCode]);

  if (!needsPairing) {
    return null;
  }

  const handleSubmit = async (value: string) => {
    const digits = value.replace(/\D/g, "");
    if (digits.length !== 6) {
      return;
    }
    setSubmitting(true);
    await submitCode(digits);
    setSubmitting(false);
  };

  return (
    <div className="pairing-gate-overlay">
      <div className="ui-card pairing-gate-card">
        <h2 style={{ margin: "0 0 4px" }}>Accès distant</h2>
        <p style={{ fontSize: "0.85rem", color: "#94a3b8", marginTop: 0 }}>
          Saisissez le code à 6 chiffres affiché dans l'application GPS-Mock sur l'ordinateur hôte
          (Réglages → Accès distant). Le code change toutes les 30 secondes.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit(code);
          }}
        >
          <input
            autoFocus
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            style={{
              width: "100%",
              fontSize: "2rem",
              letterSpacing: "0.4em",
              textAlign: "center",
              padding: "0.5rem",
              fontVariantNumeric: "tabular-nums",
            }}
          />
          {pairCodeError && (
            <span className="field-error" style={{ display: "block", marginTop: 8 }}>
              {pairCodeError}
            </span>
          )}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={code.length !== 6 || submitting}
            style={{ marginTop: 12, width: "100%" }}
          >
            {submitting ? "Appairage…" : "Se connecter"}
          </button>
        </form>
      </div>
    </div>
  );
};
