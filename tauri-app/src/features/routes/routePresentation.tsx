import type React from "react";
import { Car, Footprints, Plane, Train } from "lucide-react";
import type { LegMode } from "./routeModel";

export const MODE_META: Record<
  LegMode,
  { label: string; icon: React.ComponentType<{ size?: number }>; color: string; dashed: boolean }
> = {
  drive: { label: "Voiture", icon: Car, color: "#14b8a6", dashed: false },
  walk: { label: "Marche", icon: Footprints, color: "#5eead4", dashed: false },
  train: { label: "Train", icon: Train, color: "#a855f7", dashed: true },
  flight: { label: "Avion", icon: Plane, color: "#38bdf8", dashed: true },
};

export const autoModeToast = (mode: LegMode): string => `Mode ${MODE_META[mode].label} detecte - modifiable`;
