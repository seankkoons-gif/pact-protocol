import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // Heavy libs (jspdf, jszip) are lazy-loaded; main chunk stays under limit
    chunkSizeWarningLimit: 600,
  },
})
