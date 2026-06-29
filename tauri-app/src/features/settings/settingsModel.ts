import type { NetworkInterfaceInfo, Settings as EngineSettings } from "../../types/engine";

export type RoutingProviderId = "google" | "mapbox" | "osrm";

export const ROUTING_PROVIDER_LABELS: Record<RoutingProviderId, string> = {
  google: "Google Routes",
  mapbox: "Mapbox",
  osrm: "OSRM",
};

export const DEFAULT_ROUTING_PRIORITY: RoutingProviderId[] = ["google", "mapbox", "osrm"];

const RSD_ADDRESS_RE = /^(\d{1,3}\.){3}\d{1,3}:\d{1,5}$/;

export const isValidRsdAddress = (address: string): boolean => {
  const trimmed = address.trim();
  return trimmed === "" || RSD_ADDRESS_RE.test(trimmed);
};

export function selectQrPairingHost(networkInterfaces: NetworkInterfaceInfo[], mdnsInterface: string | null): string | null {
  return networkInterfaces.find((iface) => iface.name === mdnsInterface)?.ip ?? networkInterfaces[0]?.ip ?? null;
}

export function normalizeRoutingPriority(priority: RoutingProviderId[]): RoutingProviderId[] {
  const normalized = [...priority];
  for (const id of DEFAULT_ROUTING_PRIORITY) {
    if (!normalized.includes(id)) normalized.push(id);
  }
  return normalized;
}

export function moveRoutingProviderPriority(
  priority: RoutingProviderId[],
  provider: RoutingProviderId,
  direction: -1 | 1
): RoutingProviderId[] {
  const normalized = normalizeRoutingPriority(priority);
  const index = normalized.indexOf(provider);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= normalized.length) return normalized;
  const next = [...normalized];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

interface BuildSettingsPayloadInput {
  companionPort: string;
  preferredDriver: string;
  isEveilMode: boolean;
  eveilInterval: string;
  jitterEnabled: boolean;
  osrmBaseUrl: string;
  routingMode: "auto" | "manual";
  routingProvider: RoutingProviderId;
  routingPriority: RoutingProviderId[];
  googleRoutesApiKey: string;
  mapboxAccessToken: string;
  clusterHeartbeat: string;
  clusterMasterDead: string;
  clusterPeerTimeout: string;
}

export function buildSettingsPayload(input: BuildSettingsPayloadInput): EngineSettings {
  const routingSettings: Partial<EngineSettings> = {
    routingMode: input.routingMode,
    routingProvider: input.routingProvider,
    routingProviderPriority: input.routingPriority,
  };
  if (input.googleRoutesApiKey.trim()) routingSettings.googleRoutesApiKey = input.googleRoutesApiKey.trim();
  if (input.mapboxAccessToken.trim()) routingSettings.mapboxAccessToken = input.mapboxAccessToken.trim();

  return {
    companionPort: parseInt(input.companionPort),
    preferredDriver: input.preferredDriver,
    isEveilMode: input.isEveilMode,
    eveilInterval: parseInt(input.eveilInterval),
    jitterEnabled: input.jitterEnabled,
    osrmBaseUrl: input.osrmBaseUrl.trim(),
    ...routingSettings,
    clusterHeartbeatSeconds: parseInt(input.clusterHeartbeat) || 0,
    clusterMasterDeadSeconds: parseInt(input.clusterMasterDead) || 0,
    clusterPeerTimeoutSeconds: parseInt(input.clusterPeerTimeout) || 0,
  };
}
