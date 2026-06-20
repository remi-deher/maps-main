'use strict'

const fs = require('fs')
const path = require('path')

// On mock electron pour contrôler isPackaged
jest.mock('electron', () => ({
  app: {
    isPackaged: false
  }
}))

// On mock fs pour simuler la présence ou l'absence du fichier
jest.mock('fs')

const { resolvePython } = require('../../src/main/python-resolver')

describe('PythonResolver', () => {
  const originalResourcesPath = process.resourcesPath
  const { app } = require('electron')

  beforeEach(() => {
    jest.clearAllMocks()
    app.isPackaged = false
    process.resourcesPath = '/mock/resources'
  })

  afterAll(() => {
    process.resourcesPath = originalResourcesPath
  })

  test('should find bundled python when packaged', () => {
    app.isPackaged = true
    fs.existsSync.mockImplementation((p) => p.includes('mock') && p.endsWith('python.exe'))
    
    const result = resolvePython()
    
    expect(result).toContain('mock')
    expect(result).toContain('python.exe')
    expect(fs.existsSync).toHaveBeenCalled()
  })

  test('should find dev python when NOT packaged', () => {
    app.isPackaged = false
    // On simule que le chemin relatif mode dev existe
    fs.existsSync.mockImplementation((p) => p.includes('resources') && p.endsWith('python.exe'))
    
    const result = resolvePython()
    
    expect(result).toContain('python.exe')
    expect(result).not.toContain('mock')
  })

  test('should fallback to correct command if no bundled exe is found', () => {
    app.isPackaged = false
    fs.existsSync.mockReturnValue(false)
    
    const result = resolvePython()
    const expectedFallback = process.platform === 'win32' ? 'python' : 'python3'
    
    expect(result).toBe(expectedFallback)
  })
})
