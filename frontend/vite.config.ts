import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/auth': { target: 'http://localhost:3001', changeOrigin: true },
      '/slack': { target: 'http://localhost:3001', changeOrigin: true },
      '/health': { target: 'http://localhost:3001', changeOrigin: true },
      '/admin': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
})
