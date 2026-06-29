import type React from "react";
import type { Waypoint, LegMode } from "./routeModel";
import { autoLegMode, reverseGeocodeDetailed } from "../../lib/geocoding";
import { defaultDwellMinutes } from "./routeModel";

export function patchWithNearestPlace(
  setWaypoints: React.Dispatch<React.SetStateAction<Waypoint[]>>,
  id: string,
  lat: number,
  lon: number,
  onAuto?: (mode: LegMode) => void,
  signal?: AbortSignal
) {
  reverseGeocodeDetailed(lat, lon, signal).then((res) => {
    if (!res || signal?.aborted) return;
    setWaypoints((prev) =>
      prev.map((wp, i) => {
        if (wp.id !== id) return wp;
        const auto = autoLegMode(prev[i - 1]?.kind ?? null, res.kind) as LegMode | null;
        if (auto && auto !== wp.mode) onAuto?.(auto);
        const waitMinutes = wp.waitMinutes ?? defaultDwellMinutes(res.kind);
        return { ...wp, name: res.name, kind: res.kind, mode: auto ?? wp.mode, waitMinutes };
      })
    );
  });
}
