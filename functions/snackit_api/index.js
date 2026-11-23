'use strict'
// Advanced I/O function (Express). All Zoho Books/Inventory calls go through here so
// OAuth secrets never reach the browser. Routes are stubs until credentials are available.
const express = require('express')
const app = express()
app.use(express.json())

app.get('/health', (_req, res) => res.json({ ok: true }))

// TODO: POST /transfers  -> create Transfer Order in Zoho Books (head office -> "vending machine" + machine lookup field)
// TODO: GET  /items      -> proxy Zoho items/batches
// TODO: POST /sync/:id   -> retry failed Zoho sync
app.all('*', (_req, res) => res.status(501).json({ error: 'Not implemented yet' }))

module.exports = app
