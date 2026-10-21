import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
// Same baseline as docker/nginx/default.conf. The CSP there is report-only until it is checked
// in a browser; the dev server only gets the headers that cannot break its HMR script.
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    headers: securityHeaders,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    headers: securityHeaders,
  },
  optimizeDeps: {
    include: ['@shiftline/shared'],
  },
  define: {
    global: 'window',
  },
})