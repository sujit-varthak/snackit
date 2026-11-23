import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Catalyst serves whatever is in /client (static hosting). We build straight into it
// and emit the client-package.json that `catalyst deploy` expects.
const catalystClientManifest = () => ({
  name: 'catalyst-client-manifest',
  closeBundle() {
    if (!process.env.CATALYST_CLI) return
    const dir = resolve(import.meta.dirname, '../client')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      resolve(dir, 'client-package.json'),
      JSON.stringify({ name: 'snackit', version: '0.0.1', homepage: 'index.html', login_redirect: 'index.html' }, null, 2),
    )
  },
})

export default defineConfig({
  base: './', // relative asset paths: Catalyst serves the app under /app/
  plugins: [react(), catalystClientManifest()],
  // Default `dist` (Catalyst Slate). `npm run build:cli` writes to ../client for `catalyst deploy` (client hosting).
  build: { outDir: process.env.CATALYST_CLI ? '../client' : 'dist', emptyOutDir: true },
})
