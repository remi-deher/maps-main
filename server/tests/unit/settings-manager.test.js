'use strict'

const fs = require('fs')

// Mocking dependencies
jest.mock('electron', () => require('../mocks/electron'))
jest.mock('fs')

const settings = require('../../src/main/services/settings-manager')

describe('SettingsManager', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    settings.settings = { wifiIp: '', wifiPort: '' } // Reset internal state
  })

  test('should load settings if file exists', () => {
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(JSON.stringify({ wifiIp: '1.2.3.4' }))
    
    // On force un re-load pour le test car c'est un singleton
    settings.settings = settings._load()
    
    expect(settings.get('wifiIp')).toBe('1.2.3.4')
  })

  test('should return default settings if file is missing', () => {
    fs.existsSync.mockReturnValue(false)
    const data = settings._load()
    expect(data.wifiIp).toBe('')
  })

  test('should save settings and update memory', () => {
    fs.writeFileSync.mockReturnValue(true)
    
    settings.save({ wifiIp: '8.8.8.8', wifiPort: '53248' })
    
    expect(settings.get('wifiIp')).toBe('8.8.8.8')
    expect(fs.writeFileSync).toHaveBeenCalled()
    const callArgs = JSON.parse(fs.writeFileSync.mock.calls[0][1])
    expect(callArgs.wifiIp).toBe('8.8.8.8')
  })

  test('should handle JSON parse errors gracefully', () => {
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue('INVALID JSON')
    
    const data = settings._load()
    expect(data.wifiIp).toBe('') // Defaults
  })
})
