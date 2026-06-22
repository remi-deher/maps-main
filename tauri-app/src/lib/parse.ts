// Shared coordinate/number parsing used by the tab components (extracted from
// the former Sidebar god-component).
export const parseCoordinate = (value: string, min: number, max: number): number | null => {
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
};
