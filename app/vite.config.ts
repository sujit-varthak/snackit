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
  server: { proxy: { '/api': 'http://localhost:3100' } }, // local function: npm start in functions/snackit_api
  // On Catalyst client hosting the function answers under /server/<name> on the same domain. A build hosted elsewhere
  // (Slate) needs VITE_API_BASE set to the function's full address.
  define: process.env.CATALYST_CLI
    ? { 'import.meta.env.VITE_API_BASE': JSON.stringify(process.env.VITE_API_BASE ?? '/server/snackit_api') }
    : {},
  // Default ../web = committed static build served by Slate (Static framework, Root Path 'web'). `npm run build:cli` writes to ../client for `catalyst deploy` (client hosting).
  build: { outDir: process.env.CATALYST_CLI ? '../client' : '../web', emptyOutDir: true },
})
