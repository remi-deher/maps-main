'use strict'

// Mocking the Python path resolver and logger
jest.mock('../../src/main/python-resolver', () => ({ PYTHON: 'python' }))
jest.mock('../../src/main/logger', () => ({
  dbg: jest.fn(),
  sendStatus: jest.fn()
}))

const GpsSimulator = require('../../src/main/services/gps-simulator')
const { EventEmitter } = require('events')

describe('Service Integration: Tunnel & GPS', () => {
  let tunnelMock
  let gps

  beforeEach(() => {
    // On simule un TunnelManager simplifié
    tunnelMock = new EventEmitter()
    tunnelMock.getRsdAddress = jest.fn().mockReturnValue('1.2.3.4')
    tunnelMock.getRsdPort = jest.fn().mockReturnValue('53248')
    
    gps = new GpsSimulator(tunnelMock)
    
    // On mock la méthode interne _spawn pour ne pas lancer de vrai processus
    gps._spawn = jest.fn().mockResolvedValue({ success: true, latencyMs: 100 })
  })

  test('should restore location automatically when tunnel is restored', async () => {
    // 1. On définit une position initiale
    await gps.setLocation(48.8, 2.3, 'Paris')
    expect(gps.lastCoords.name).toBe('Paris')
    
    // 2. On simule la perte du tunnel (le process meurt)
    gps.stop()
    expect(gps.process).toBeNull()

    // 3. On simule le rétablissement du tunnel via l'événement attendu
    gps.onTunnelRestored()
    
    // 4. On vérifie que setLocation a été rappelé avec les bonnes coordonnées
    expect(gps._spawn).toHaveBeenCalledTimes(2) // 1 initial + 1 restauration
    const secondCall = gps._spawn.mock.calls[1]
    expect(secondCall[0]).toBe('set')
    expect(secondCall[1]).toEqual(['48.8', '2.3'])
  })

  test('should NOT restore if no previous location was set', () => {
    gps.onTunnelRestored()
    expect(gps._spawn).not.toHaveBeenCalled()
  })

  test('should stop watchdog on destroy', () => {
    gps._startWatchdog()
    expect(gps.watchdogTimer).not.toBeNull()
    
    gps.destroy()
    expect(gps.watchdogTimer).toBeNull()
    expect(gps._isQuitting).toBe(true)
  })
})
