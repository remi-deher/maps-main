import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, 'renderer-v2'), // On repart de renderer-v2 comme racine
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist-web'), // Sortie directe dans dist-web
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'renderer-v2/src'),
    },
  },
  server: {
    port: 3000,
  },
})
