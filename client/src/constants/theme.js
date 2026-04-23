export const COLORS = {
  primary: '#6366f1',
  primaryDark: '#4f46e5',
  background: '#0f172a',
  surface: '#1e293b',
  surfaceLight: '#334155',
  error: '#f43f5e',
  success: '#10b981',
  warning: '#f59e0b',
  text: '#f8fafc',
  textSecondary: '#94a3b8',
  textMuted: '#64748b'
};

export const SHADOWS = {
  premium: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  light: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  }
};

export const MAP_DARK_STYLE = [
  { "elementType": "geometry", "stylers": [{ "color": "#1e293b" }] },
  { "elementType": "labels.text.fill", "stylers": [{ "color": "#94a3b8" }] },
  { "elementType": "labels.text.stroke", "stylers": [{ "color": "#1e293b" }] },
  { "featureType": "road", "elementType": "geometry", "stylers": [{ "color": "#334155" }] },
  { "featureType": "water", "elementType": "geometry", "stylers": [{ "color": "#0f172a" }] }
];
