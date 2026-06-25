// Shared coordinate/number parsing used by the map panels and modals.
export const parseCoordinate = (value: string, min: number, max: number): number | null => {
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
};
