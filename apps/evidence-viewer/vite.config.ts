import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Stub Node-only verifier modules so the browser bundle doesn't pull in node:fs/crypto/path/url.
    // Core path always passes transcript object and constitutionContent, so these are never called.
    alias: [
      {
        find: './load_transcript_node.js',
        replacement: path.resolve(__dirname, 'src/lib/verifier-stubs/load_transcript_node.ts'),
      },
      {
        find: '../load_constitution_node.js',
        replacement: path.resolve(__dirname, 'src/lib/verifier-stubs/load_constitution_node.ts'),
      },
    ],
  },
  build: {
    // Heavy libs (jspdf, jszip) are lazy-loaded; main chunk stays under limit
    chunkSizeWarningLimit: 600,
  },
})
