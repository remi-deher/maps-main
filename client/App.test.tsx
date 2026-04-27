import React from 'react';
// App.test.tsx (v1.2.7-types-fix)
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
  it('renders correctly (Smoke Test)', () => {
    // On wrap dans un try/catch pour capturer les erreurs de boot
    try {
      const tree = renderer.create(<App />).toJSON();
      expect(tree).toBeDefined();
    } catch (error) {
      console.error("SMOKE TEST FAILED: The application crashed during rendering.");
      throw error;
    }
  });
});
