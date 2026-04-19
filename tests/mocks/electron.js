'use strict'

module.exports = {
  app: {
    getPath: jest.fn().mockImplementation((name) => {
      if (name === 'userData') return '/tmp/userData'
      if (name === 'logs') return '/tmp/logs'
      return `/tmp/${name}`
    })
  },
  ipcMain: {
    handle: jest.fn(),
    on: jest.fn()
  },
  shell: {
    openPath: jest.fn()
  }
}
