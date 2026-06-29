import React, { createContext, useContext, useState, useEffect } from "react";
import { getStoredToken, setStoredToken, clearStoredToken, sameOriginHttpUrl, isTauri } from "../lib/runtime";
import { engineEvents } from "../lib/events";
import type { PairedDevice, RemotePairCode, PairResult } from "../types/engine";

export interface PairingContextValue {
  needsPairing: boolean;
  setNeedsPairing: (needs: boolean) => void;
  pairCodeError: string | null;
  setPairCodeError: (err: string | null) => void;
  prefillCode: string | null;
  setPrefillCode: (code: string | null) => void;
  deviceToken: string | null;
  setDeviceToken: (token: string | null) => void;
  pairedDevices: PairedDevice[];
  setPairedDevices: (devices: PairedDevice[]) => void;
  submitCode: (code: string, label?: string) => Promise<boolean>;
  forgetPairing: () => void;
  pairResult: PairResult | null;
  setPairResult: (res: PairResult | null) => void;
  pairing: boolean;
  setPairing: (val: boolean) => void;
  pairDevice: () => void;
  remotePairCode: RemotePairCode | null;
  setRemotePairCode: (code: RemotePairCode | null) => void;
  requestPairCode: () => void;
  requestPairedDevices: () => void;
  revokePairedDevice: (id: string) => void;
}

const PairingContext = createContext<PairingContextValue | null>(null);

export const PairingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [deviceToken, setDeviceTokenState] = useState<string | null>(() => (isTauri ? null : getStoredToken()));
  const [needsPairing, setNeedsPairing] = useState(false);
  const [pairCodeError, setPairCodeError] = useState<string | null>(null);
  const [prefillCode, setPrefillCode] = useState<string | null>(null);
  const [remotePairCode, setRemotePairCode] = useState<RemotePairCode | null>(null);
  const [pairedDevices, setPairedDevices] = useState<PairedDevice[]>([]);
  const [pairResult, setPairResult] = useState<PairResult | null>(null);
  const [pairing, setPairing] = useState(false);

  const setDeviceToken = (token: string | null) => {
    setDeviceTokenState(token);
    engineEvents.emit("reconnect", token);
  };

  const submitCode = async (code: string, label?: string): Promise<boolean> => {
    setPairCodeError(null);
    try {
      const resp = await fetch(sameOriginHttpUrl("/api/pair"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim(), label: label || navigator.userAgent.slice(0, 60) }),
      });
      if (!resp.ok) {
        setPairCodeError(resp.status === 401 ? "Code invalide ou expiré." : `Échec de l'appairage (${resp.status}).`);
        return false;
      }
      const data = (await resp.json()) as { token?: string };
      if (!data.token) {
        setPairCodeError("Réponse d'appairage invalide.");
        return false;
      }
      setStoredToken(data.token);
      setPrefillCode(null);
      setNeedsPairing(false);
      setDeviceToken(data.token);
      return true;
    } catch {
      setPairCodeError("Impossible de joindre le moteur.");
      return false;
    }
  };

  const forgetPairing = () => {
    clearStoredToken();
    setDeviceToken(null);
    setNeedsPairing(true);
  };

  useEffect(() => {
    if (isTauri) return;
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get("token");
    if (urlToken) {
      setStoredToken(urlToken);
      setDeviceToken(urlToken);
    }
    const pair = params.get("pair");
    if (pair) {
      setPrefillCode(pair);
    }
    if (urlToken || pair) {
      params.delete("token");
      params.delete("pair");
      const qs = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }
    if (!urlToken && !getStoredToken()) {
      setNeedsPairing(true);
    }
  }, []);

  const pairDevice = () => {
    setPairResult(null);
    setPairing(true);
    engineEvents.emit("send", "PAIR_DEVICE");
  };

  const requestPairCode = () => engineEvents.emit("send", "GET_PAIR_CODE");
  const requestPairedDevices = () => engineEvents.emit("send", "LIST_PAIRED_DEVICES");
  const revokePairedDevice = (id: string) => engineEvents.emit("send", "REVOKE_PAIRED_DEVICE", { id });

  useEffect(() => {
    const handlePairResult = (data: PairResult) => {
      setPairResult(data);
      setPairing(false);
    };
    const handlePairCode = (data: any) => {
      if (data?.error) {
        setRemotePairCode(null);
      } else {
        setRemotePairCode({ code: data.code, secondsRemaining: data.secondsRemaining });
      }
    };
    const handlePairedDevices = (data: any) => {
      setPairedDevices(Array.isArray(data?.devices) ? data.devices : []);
    };
    const handleNeedsPairing = (needs: boolean) => {
      setNeedsPairing(needs);
    };

    engineEvents.on("pair_result", handlePairResult);
    engineEvents.on("pair_code", handlePairCode);
    engineEvents.on("paired_devices", handlePairedDevices);
    engineEvents.on("needs_pairing", handleNeedsPairing);

    return () => {
      engineEvents.off("pair_result", handlePairResult);
      engineEvents.off("pair_code", handlePairCode);
      engineEvents.off("paired_devices", handlePairedDevices);
      engineEvents.off("needs_pairing", handleNeedsPairing);
    };
  }, []);

  return (
    <PairingContext.Provider
      value={{
        needsPairing,
        setNeedsPairing,
        pairCodeError,
        setPairCodeError,
        prefillCode,
        setPrefillCode,
        deviceToken,
        setDeviceToken,
        pairedDevices,
        setPairedDevices,
        submitCode,
        forgetPairing,
        pairResult,
        setPairResult,
        pairing,
        setPairing,
        pairDevice,
        remotePairCode,
        setRemotePairCode,
        requestPairCode,
        requestPairedDevices,
        revokePairedDevice,
      }}
    >
      {children}
    </PairingContext.Provider>
  );
};

export const usePairing = () => {
  const ctx = useContext(PairingContext);
  if (!ctx) throw new Error("usePairing must be used within PairingProvider");
  return ctx;
};
