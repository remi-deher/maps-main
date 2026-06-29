import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

export function configureLeafletDefaultIcons() {
  delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconUrl: markerIcon,
    iconRetinaUrl: markerIcon2x,
    shadowUrl: markerShadow,
  });
}

const dotIcon = (color: string, className: string, size = 14, border = 3) =>
  L.divIcon({
    html: `<div style="background-color: ${color}; width: ${size}px; height: ${size}px; border-radius: 50%; border: ${border}px solid #ffffff; box-shadow: 0 0 10px ${color};"></div>`,
    className,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });

export const mockIcon = dotIcon("#10b981", "custom-mock-icon");
export const destIcon = dotIcon("#0ea5e9", "custom-dest-icon");
export const realIcon = dotIcon("#ef4444", "custom-real-icon");
export const patrolPreviewIcon = dotIcon("#f59e0b", "custom-patrol-preview-icon");
export const patrolCenterIcon = dotIcon("#f59e0b", "patrol-center-dot", 12, 2);

export const startIcon = L.divIcon({
  html: `<div style="background-color: #0ea5e9; width: 22px; height: 22px; border-radius: 50%; border: 2px solid #ffffff; box-shadow: 0 0 8px #0ea5e9; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 11px; font-weight: 700; font-family: sans-serif;">D</div>`,
  className: "custom-start-icon",
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

export const waypointIcon = (index: number) =>
  L.divIcon({
    html: `<div style="background-color: #14b8a6; width: 22px; height: 22px; border-radius: 50%; border: 2px solid #ffffff; box-shadow: 0 0 8px #14b8a6; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 11px; font-weight: 700; font-family: sans-serif;">${index + 1}</div>`,
    className: "custom-waypoint-icon",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
