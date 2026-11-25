'use strict'
// Runs every test twice: on the memory store and on the Catalyst adapter (over the fake Catalyst).
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const files = fs.readdirSync('test').filter((f) => f.endsWith('.test.js')).map((f) => `test/${f}`)
let failed = false
for (const impl of ['memory', 'catalyst']) {
  console.log(`\n=== tests on the ${impl} store ===`)
  const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', env: { ...process.env, STORE_TEST: impl } })
  if (r.status !== 0) failed = true
}
process.exit(failed ? 1 : 0)
