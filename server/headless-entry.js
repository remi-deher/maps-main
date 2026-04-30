'use strict'

/**
 * Headless Entry Point for GPS Mock V2
 * Usage: node headless-entry.js
 */

const companionServer = require('./src/main/core/services/companion-server')
const HeadlessTarget = require('./src/main/targets/HeadlessTarget')
const orchestrator = require('./src/main/core/services/TunnelManager')
const { dbg } = require('./src/main/logger')

dbg('--- GPS MOCK HEADLESS MODE ---')

const companion = new companionServer(orchestrator)
const target = new HeadlessTarget(companion)

target.start().catch(err => {
  console.error('Failed to start Headless Target:', err)
  process.exit(1)
})

process.on('SIGINT', () => {
  dbg('Shutting down...')
  target.stop()
  process.exit(0)
})
