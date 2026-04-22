'use strict'

// Mocking dependencies
jest.mock('../../src/main/logger', () => ({
  dbg: jest.fn(),
  sendStatus: jest.fn()
}))

const ConnectionState = require('../../src/main/tunneld/connection-state')

describe('ConnectionState', () => {
  let state

  beforeEach(() => {
    state = new ConnectionState()
  })

  test('should initialize with null state', () => {
    expect(state.address).toBeNull()
    expect(state.type).toBeNull()
    expect(state.isConnected).toBe(false)
  })

  test('should connect correctly', () => {
    state.setConnected('192.168.0.1', '53248', 'WiFi')
    expect(state.address).toBe('192.168.0.1')
    expect(state.type).toBe('WiFi')
    expect(state.isConnected).toBe(true)
  })

  test('should allow USB to preempt WiFi', () => {
    state.setConnected('192.168.0.1', '53248', 'WiFi')
    const success = state.setConnected('fd12:b3c3:867e::1', '53411', 'USB')
    
    expect(success).toBe(true)
    expect(state.type).toBe('USB')
    expect(state.address).toBe('fd12:b3c3:867e::1')
  })

  test('should REFUSE Network preemption if WiFi is stable', () => {
    state.setConnected('192.168.0.1', '53248', 'WiFi')
    
    // Tentative de connexion "Network" (venant du daemon USB qui voit aussi l'iPhone sur le réseau)
    const success = state.setConnected('192.168.0.1', '53411', 'Network')
    
    expect(success).toBe(false)
    expect(state.type).toBe('WiFi') // Reste sur WiFi
  })

  test('should clear state on disconnect', () => {
    state.setConnected('192.168.0.1', '53248', 'WiFi')
    state.setDisconnected('Unit Test')
    
    expect(state.address).toBeNull()
    expect(state.isConnected).toBe(false)
  })
})
