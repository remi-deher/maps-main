import React from 'react';
// App.test.tsx (v1.2.8-expo-mocks-fix)
import renderer from 'react-test-renderer';
import App from './App';

// Mock de Socket.io pour éviter les erreurs de réseau en test
jest.mock('socket.io-client', () => {
  return jest.fn(() => ({
    on: jest.fn(),
    emit: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
  }));
});

// Mock de AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Mock de Expo Task Manager
jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(() => Promise.resolve(true)),
  getRegisteredTasksAsync: jest.fn(() => Promise.resolve([])),
}));

// Mock de Expo Location
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  requestBackgroundPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  getForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  getBackgroundPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  startLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(),
  Accuracy: { BestForNavigation: 5 },
  geocodeAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
}));

// Mock de MapView car c'est un composant natif complexe
jest.mock('react-native-maps', () => {
  const React = require('react');
  const View = require('react-native').View;
  return {
    __esModule: true,
    default: (props: any) => React.createElement(View, props),
    Marker: (props: any) => React.createElement(View, props),
  };
});

describe('<App />', () => {
  it('renders correctly (Smoke Test)', async () => {
    // On wrap dans un try/catch pour capturer les erreurs de boot
    try {
      let tree;
      await renderer.act(async () => {
        tree = renderer.create(<App />);
      });
      expect(tree).toBeDefined();
    } catch (error) {
      console.error("SMOKE TEST FAILED: The application crashed during rendering.");
      throw error;
    }
  });
});
