const { _electron: electron } = require('playwright')
const { test, expect } = require('@playwright/test')
const path = require('path')

test.describe('E2E: App Launch', () => {
  let electronApp

  test.beforeAll(async () => {
    // On lance l'application Electron
    electronApp = await electron.launch({ 
      args: [path.join(__dirname, '../../main.js')],
      executablePath: process.env.ELECTRON_PATH // Permet de passer le chemin d'electron pour le CI
    })
  })

  test.afterAll(async () => {
    await electronApp.close()
  })

  test('should display the correct window title', async () => {
    const window = await electronApp.firstWindow()
    const title = await window.title()
    expect(title).toBe('GPS Mock — iPhone Location Spoofer')
  })

  test('should have the map container', async () => {
    const window = await electronApp.firstWindow()
    const map = await window.locator('#map')
    await expect(map).toBeVisible()
  })

  test('should show the tunnel status badge', async () => {
    const window = await electronApp.firstWindow()
    const badge = await window.locator('#tunnel-badge')
    await expect(badge).toBeVisible()
    const text = await badge.innerText()
    // Au démarrage, c'est soit "Connexion..." soit "iPhone connecté"
    expect(text).toMatch(/Connexion|iPhone/i)
  })
})
