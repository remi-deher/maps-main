/**
 * state.js — Variables partagées du renderer
 *
 * Expose un objet global `AppState` accessible par tous les modules JS du renderer.
 * Chargé en PREMIER dans index.html (avant map.js, search.js, etc.)
 */

/* global AppState */

window.AppState = {
  // Position sélectionnée sur la carte
  selectedLat: null,
  selectedLon: null,
  selectedName: null,

  // Simulation en cours : { lat, lon, name } ou null
  activeSim: null,

  // Instance du marker Leaflet
  marker: null,
}
