// Mock pour @expo/vector-icons
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    Ionicons: (props) => React.createElement(View, props),
    MaterialIcons: (props) => React.createElement(View, props),
    MaterialCommunityIcons: (props) => React.createElement(View, props),
    FontAwesome: (props) => React.createElement(View, props),
    Feather: (props) => React.createElement(View, props),
  };
});

// Mock pour expo-font
jest.mock('expo-font', () => ({
  loadAsync: jest.fn().mockResolvedValue(true),
  isLoaded: jest.fn().mockReturnValue(true),
  isLoading: jest.fn().mockReturnValue(false),
}));

// Mock pour expo-asset
jest.mock('expo-asset', () => ({
  Asset: {
    loadAsync: jest.fn().mockResolvedValue(true),
    fromModule: jest.fn().mockReturnValue({ uri: 'mocked-uri' }),
  },
}));

// Mock pour react-native-maps
jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockMapView = (props) => React.createElement(View, props, props.children);
  const MockMarker = (props) => React.createElement(View, props, props.children);
  const MockCircle = (props) => React.createElement(View, props, props.children);
  const MockPolygon = (props) => React.createElement(View, props, props.children);
  const MockPolyline = (props) => React.createElement(View, props, props.children);
  
  return {
    __esModule: true,
    default: MockMapView,
    Marker: MockMarker,
    Circle: MockCircle,
    Polygon: MockPolygon,
    Polyline: MockPolyline,
  };
});
