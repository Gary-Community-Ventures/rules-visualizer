import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { fileURLToPath } from 'url'

const PROXY_TARGET = process.env.PROXY_TARGET || 'http://localhost:5000'

// https://vite.dev/config/
export default defineConfig({
  // Read .env from the repo root so frontend (VITE_*) and backend share one file.
  envDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(path.dirname(fileURLToPath(import.meta.url)), './src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: PROXY_TARGET,
        changeOrigin: true,
      },
      '/ws': {
        target: PROXY_TARGET,
        ws: true,
      },
    },
  },
})
