import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5173,
    // API Worker (wrangler dev) di port 8787
    proxy: { '/api': 'http://localhost:8787' },
    // The demo-video recorder writes large files under docs/lomba/video/out*; watching them
    // crashes the dev server on Windows (EBUSY) in the middle of a recording.
    watch: { ignored: ['**/docs/lomba/video/out*/**'] },
  },
  build: { outDir: 'dist' },
})
