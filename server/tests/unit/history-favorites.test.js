/**
 * @jest-environment jsdom
 */
'use strict'

describe('HistoryFavModule', () => {
  let HistoryFavModule

  beforeEach(() => {
    // Setup minimal DOM
    document.body.innerHTML = `
      <div id="tab-history"></div>
      <div id="history-empty"></div>
      <div id="tab-favorites"></div>
      <div id="favorites-empty"></div>
      <input id="fav-search" />
      <div id="modal-overlay"></div>
      <input id="modal-input" />
      <button id="modal-confirm"></button>
      <button id="modal-cancel"></button>
      <button id="btn-favorite"></button>
    `

    // Mock dependencies
    window.StorageService = {
      getHistory: jest.fn().mockReturnValue([]),
      getFavorites: jest.fn().mockReturnValue([]),
      saveHistory: jest.fn(),
      saveFavorites: jest.fn()
    }
    window.MapModule = {
      placeMarker: jest.fn(),
      map: { setView: jest.fn() }
    }
    window.UIModule = { showToast: jest.fn() }
    window.AppState = { selectedLat: null, selectedLon: null, selectedName: null }

    // Load the module (using require to trigger IIFE)
    jest.isolateModules(() => {
      require('../../renderer/js/history-favorites')
      HistoryFavModule = window.HistoryFavModule
    })
  })

  test('should add to history and update DOM', () => {
    HistoryFavModule.addToHistory(48.8566, 2.3522, 'Paris')
    
    expect(window.StorageService.saveHistory).toHaveBeenCalled()
    const historyList = document.getElementById('tab-history')
    expect(historyList.querySelectorAll('.list-item')).toHaveLength(1)
    expect(historyList.querySelector('.list-item-name').textContent).toBe('Paris')
  })

  test('should handle favorites naming modal', () => {
    HistoryFavModule.openModal(40.7128, -74.0060, 'NYC')
    
    const overlay = document.getElementById('modal-overlay')
    const input = document.getElementById('modal-input')
    const confirmBtn = document.getElementById('modal-confirm')

    expect(overlay.classList.contains('visible')).toBe(true)
    expect(input.value).toBe('NYC')

    // Simulate naming and confirming
    input.value = 'New York City'
    confirmBtn.click()

    expect(window.StorageService.saveFavorites).toHaveBeenCalled()
    expect(overlay.classList.contains('visible')).toBe(false)
  })

  test('should filter favorites list', () => {
    // On ré-isole pour avoir des données initiales spécifiques
    jest.isolateModules(() => {
      window.StorageService.getFavorites.mockReturnValue([
        { name: 'Paris', lat: 0, lon: 0 },
        { name: 'London', lat: 0, lon: 0 }
      ])
      require('../../renderer/js/history-favorites')
      HistoryFavModule = window.HistoryFavModule
    })
    
    const search = document.getElementById('fav-search')
    search.value = 'Par'
    search.dispatchEvent(new Event('input'))

    const favList = document.getElementById('tab-favorites')
    expect(favList.querySelectorAll('.list-item')).toHaveLength(1)
    expect(favList.querySelector('.list-item-name').textContent).toBe('Paris')
  })
})
