import React from "react";
import { useEngine } from "../../context/websocket";
import {
  DEFAULT_ROUTING_PRIORITY,
  ROUTING_PROVIDER_LABELS,
  type RoutingProviderId,
} from "../../features/settings/settingsModel";
import type { SettingsForm } from "../../features/settings/useSettingsForm";
import { SaveSettingsButton } from "./SaveSettingsButton";

// Which service computes the itineraries, in what order, and with which keys —
// plus the two rail options, which are browser-local and never reach the engine.
export const RoutingSection: React.FC<{ form: SettingsForm }> = ({ form }) => {
  const { canSend } = useEngine();
  const { routingProviderInfos, routingProviderInfoById, activeRoutingProvider } = form;

  return (
    <div className="ui-card">
      <fieldset className="field-group">
        <legend className="field-group-legend">Routage</legend>
        <div className="form-group">
          <label className="form-label">Serveur de routage (OSRM)</label>
          <input
            type="text"
            value={form.osrmBaseUrl}
            placeholder="http://router.project-osrm.org"
            onChange={(e) => form.setOsrmBaseUrl(e.target.value)}
          />
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label className="form-label">Provider utilise actuellement</label>
              <div className="info-grid">
                <div className="info-item">
                  <span className="info-label">Actif</span>
                  <span className="info-value green">{ROUTING_PROVIDER_LABELS[activeRoutingProvider]}</span>
                </div>
                {routingProviderInfos.map((provider) => (
                  <div className="info-item" key={provider.id}>
                    <span className="info-label">{provider.name}</span>
                    <span className={`info-value ${provider.available ? "green" : "warning"}`}>
                      {provider.available ? "Disponible" : provider.configured ? "Configure" : "Cle absente"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="form-label">Mode de selection</label>
              <select
                value={form.routingMode}
                onChange={(e) => form.setRoutingMode(e.target.value as "auto" | "manual")}
              >
                <option value="auto">Auto - ordre de priorite serveur</option>
                <option value="manual">Manuel - provider force</option>
              </select>
              <small className="form-hint">
                En auto, le moteur essaie les providers disponibles selon l'ordre ci-dessous.
              </small>
            </div>

            {form.routingMode === "manual" && (
              <div>
                <label className="form-label">Provider manuel</label>
                <select
                  value={form.routingProvider}
                  onChange={(e) => form.setRoutingProvider(e.target.value as RoutingProviderId)}
                >
                  {DEFAULT_ROUTING_PRIORITY.map((id) => (
                    <option key={id} value={id}>
                      {ROUTING_PROVIDER_LABELS[id]}{routingProviderInfoById[id]?.available ? "" : " (indisponible)"}
                    </option>
                  ))}
                </select>
                {!routingProviderInfoById[form.routingProvider]?.available && (
                  <small className="field-error">
                    Ce provider n'est pas disponible: le moteur retombera sur l'ordre auto.
                  </small>
                )}
              </div>
            )}

            <div>
              <label className="form-label">Priorite du mode auto</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {form.routingPriority.map((id, index) => (
                  <div key={id} className="info-item" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="info-label" style={{ minWidth: 24 }}>{index + 1}</span>
                    <span className="info-value compact" style={{ flex: 1 }}>
                      {ROUTING_PROVIDER_LABELS[id]}
                      {!routingProviderInfoById[id]?.available ? " - indisponible tant que la cle est absente" : ""}
                    </span>
                    <button
                      className="btn btn-secondary"
                      type="button"
                      disabled={index === 0}
                      onClick={() => form.moveRoutingProvider(id, -1)}
                    >
                      Haut
                    </button>
                    <button
                      className="btn btn-secondary"
                      type="button"
                      disabled={index === form.routingPriority.length - 1}
                      onClick={() => form.moveRoutingProvider(id, 1)}
                    >
                      Bas
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="form-label">Cle API Google Routes</label>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  type="password"
                  value={form.googleRoutesApiKey}
                  placeholder={routingProviderInfoById.google?.configured ? "Cle deja configuree - laisser vide pour conserver" : "GOOGLE_MAPS_API_KEY"}
                  onChange={(e) => form.setGoogleRoutesApiKey(e.target.value)}
                />
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={!canSend || !routingProviderInfoById.google?.configured}
                  onClick={() => form.clearRoutingSecret("google")}
                >
                  Effacer
                </button>
              </div>
            </div>

            <div>
              <label className="form-label">Token Mapbox</label>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  type="password"
                  value={form.mapboxAccessToken}
                  placeholder={routingProviderInfoById.mapbox?.configured ? "Token deja configure - laisser vide pour conserver" : "MAPBOX_ACCESS_TOKEN"}
                  onChange={(e) => form.setMapboxAccessToken(e.target.value)}
                />
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={!canSend || !routingProviderInfoById.mapbox?.configured}
                  onClick={() => form.clearRoutingSecret("mapbox")}
                >
                  Effacer
                </button>
              </div>
            </div>
          </div>
          <small className="form-hint">
            Serveur OSRM utilisé pour calculer les itinéraires. Laissez vide pour
            l'instance publique par défaut, ou indiquez votre serveur auto-hébergé
            (confidentialité, hors-ligne, limites de débit).
          </small>
        </div>
      </fieldset>

      <fieldset className="field-group">
        <legend className="field-group-legend">Train — réglages locaux (navigateur)</legend>
        <div className="form-group">
          <label className="form-label">Routeur ferroviaire (optionnel)</label>
          <input
            type="text"
            value={form.railRouterUrl}
            placeholder="https://mon-osrm-rail.exemple"
            onChange={(e) => form.setRailRouterUrl(e.target.value)}
          />
          <small className="form-hint">
            Service compatible OSRM (ex. OSRM avec profil rail, ou BRouter) pour faire
            suivre les voies aux étapes en mode Train. Vide = train en ligne droite.
            Réglage local au navigateur (non transmis au moteur).
          </small>
        </div>

        <div className="form-group">
          <label className="switch-label">
            <span className="form-label">Horaires de train réels (Transitous)</span>
            <span className="switch-control">
              <input
                type="checkbox"
                checked={form.transitEnabled}
                onChange={(e) => form.setTransitEnabled(e.target.checked)}
              />
              <span className="switch-slider"></span>
            </span>
          </label>
          <small className="form-hint">
            Récupère vrais horaires, voies et nom du train pour les tronçons gare→gare
            (service public gratuit). Repli sur l'estimation si indisponible.
          </small>
        </div>
      </fieldset>

      <SaveSettingsButton onSave={form.handleSaveSettings} />
    </div>
  );
};
