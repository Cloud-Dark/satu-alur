import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5173,
    // API Worker (wrangler dev) di port 8787
    proxy: { '/api': 'http://localhost:8787' },
  },
  build: { outDir: 'dist' },
})
