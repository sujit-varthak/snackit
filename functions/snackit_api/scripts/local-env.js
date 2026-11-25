'use strict'
const fs = require('node:fs')
const path = require('node:path')

// Local settings (Zoho credentials) are read from .env at the repository root. It is outside the function folder,
// so `catalyst deploy` never uploads it, and git ignores it. Variables already set in the terminal win.
function loadLocalSettings() {
  const file = path.join(__dirname, '../../../.env')
  if (fs.existsSync(file)) process.loadEnvFile(file)
}

module.exports = { loadLocalSettings }
