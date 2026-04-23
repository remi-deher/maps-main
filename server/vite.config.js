import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist-web'),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'renderer-v2/index.html'),
    }
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
