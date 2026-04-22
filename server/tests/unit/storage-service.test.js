/**
 * @jest-environment jsdom
 */
'use strict'

require('../../renderer/js/services/storage-service')

describe('StorageService', () => {
  const service = window.StorageService

  beforeEach(() => {
    localStorage.clear()
    jest.clearAllMocks()
  })

  test('should save and retrieve history', () => {
    const history = [{ lat: 10, lon: 20, name: 'Test' }]
    service.saveHistory(history)
    
    const retrieved = service.getHistory()
    expect(retrieved).toHaveLength(1)
    expect(retrieved[0].name).toBe('Test')
    expect(localStorage.getItem('gps_history')).toContain('Test')
  })

  test('should return empty array if no history', () => {
    const history = service.getHistory()
    expect(history).toEqual([])
  })

  test('should handle theme persistence', () => {
    service.saveTheme('light')
    expect(service.getTheme()).toBe('light')
    expect(localStorage.getItem('gps_theme')).toBe('"light"')
  })

  test('should return default theme if none saved', () => {
    expect(service.getTheme()).toBe('dark')
  })
})
