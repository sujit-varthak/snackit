'use strict'
// The deployed wiring: index.js with STORE=catalyst, the real Catalyst SDK, and a local server standing in for
// Catalyst (backed by test/fake-catalyst.js). It checks the calls the SDK makes and how its errors reach us.
// The server's answers are our reading of Catalyst, so a first deploy still has to confirm them.
const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { createFakeCatalyst } = require('./fake-catalyst')

const db = createFakeCatalyst()
const seen = [] // requests that reached "Catalyst"

async function answer(method, path, body) {
  let m
  if (method === 'POST' && path.endsWith('/query')) {
    const sql = body.query
    if ((m = /^SELECT \* FROM (\w+) WHERE (\w+) = '((?:[^']|'')*)'$/.exec(sql))) {
      const row = await db.find(m[1], m[2], m[3].replace(/''/g, "'"))
      return row ? [{ [m[1]]: row }] : []
    }
    if ((m = /^SELECT \* FROM (\w+) LIMIT (\d+), (\d+)$/.exec(sql))) {
      // counts the offset from 1, the unhelpful case: pages then share a row
      const from = Math.max(Number(m[2]) - 1, 0)
      return (await db.all(m[1])).slice(from, from + Number(m[3])).map((r) => ({ [m[1]]: r }))
    }
    throw new Error(`unexpected query ${sql}`)
  }
  if ((m = /\/table\/(\w+)\/row$/.exec(path))) {
    if (method === 'POST') return [await db.insert(m[1], body[0])]
    if (method === 'PATCH') {
      const { ROWID, ...row } = body[0]
      await db.update(m[1], ROWID, row)
      return [body[0]]
    }
  }
  if (method === 'DELETE' && (m = /\/table\/(\w+)\/row\/(\d+)$/.exec(path))) {
    await db.remove(m[1], m[2])
    return { ROWID: m[2] }
  }
  throw new Error(`unexpected ${method} ${path}`)
}

const catalystServer = http.createServer((req, res) => {
  let text = ''
  req.on('data', (c) => (text += c))
  req.on('end', async () => {
    const path = new URL(req.url, 'http://x').pathname
    seen.push({ method: req.method, path, authorization: req.headers.authorization })
    try {
      const data = await answer(req.method, path, text ? JSON.parse(text) : undefined)
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'success', data }))
    } catch (e) {
      res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'failure', data: { error_code: e.code, message: e.message } }))
    }
  })
})

// What Catalyst adds to every request it hands the function.
const platform = {
  'x-zc-projectid': '1', 'x-zc-project-key': 'key', 'x-zc-environment': 'Development',
  'x-zc-admin-cred-type': 'token', 'x-zc-admin-cred-token': 'admin-token',
  'x-zc-user-cred-type': 'token', 'x-zc-user-cred-token': 'user-token',
}

function loadFunction(env) {
  Object.assign(process.env, env)
  delete require.cache[require.resolve('../index')]
  return require('../index').listen(0)
}
async function call(server, method, path, body) {
  const res = await fetch(`http://localhost:${server.address().port}${path}`, {
    method,
    headers: { ...platform, 'content-type': 'application/json', 'x-user-email': 'a@example.com', 'x-user-role': 'admin' },
    body: body && JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() }
}

test.before(async () => {
  await new Promise((resolve) => catalystServer.listen(0, '127.0.0.1', resolve))
  process.env.X_ZOHO_CATALYST_CONSOLE_URL = `http://127.0.0.1:${catalystServer.address().port}`
  delete process.env.ZOHO_MODE
  delete process.env.DEV_AUTH
})
test.after(() => catalystServer.close())

test('on the real tables nobody gets in until sign-in is set up or testing is switched on', async () => {
  const server = loadFunction({ STORE: 'catalyst' })
  try {
    const r = await call(server, 'GET', '/api/vendors')
    assert.equal(r.status, 403)
    assert.match(r.body.error.message, /Sign-in is not set up/)
    assert.equal(seen.length, 0)
    assert.equal((await call(server, 'GET', '/health')).status, 200)
  } finally {
    server.close()
  }
})

test('a request is written to and read from the Catalyst tables with admin access', async () => {
  const server = loadFunction({ STORE: 'catalyst', DEV_AUTH: 'on' })
  try {
    // a request with a body: the per-request store must survive reading it
    const made = await call(server, 'POST', '/api/vendors', { name: "Ravi's Foods" })
    assert.equal(made.status, 200, JSON.stringify(made.body))
    assert.equal(db.dump('vendors')[0].name, "Ravi's Foods")
    const edited = await call(server, 'PUT', `/api/vendors/${made.body.vendor_code}`, { name: "Ravi's Foods", phone: '98' })
    assert.equal(edited.status, 200, JSON.stringify(edited.body))
    const list = await call(server, 'GET', '/api/vendors')
    assert.deepEqual(list.body.map((v) => [v.vendor_code, v.phone, v.active]), [['V-001', '98', true]])
    assert.ok(seen.length > 0 && seen.every((s) => s.authorization === 'Zoho-oauthtoken admin-token'))
  } finally {
    server.close()
  }
})

test('refusals from the SDK become our errors, deletes work, and long lists lose and repeat nothing', async () => {
  const catalyst = require('zcatalyst-sdk-node')
  const { createCatalystStore } = require('../src/store/catalyst')
  const { createSdkClient } = require('../src/store/catalyst-sdk')
  const store = createCatalystStore(createSdkClient(catalyst.initialize({ headers: platform }, { scope: 'admin' })))
  const setting = (n) => ({ setting_key: `k${n}`, setting_value: String(n) })
  await store.insert('settings', setting(0))
  await assert.rejects(store.insert('settings', setting(0)), (e) => e.code === 'DUPLICATE')
  await assert.rejects(store.insert('settings', { setting_key: 'x', nonsense: '1' }), (e) => e.code === 'INVALID_OPERATION' && /nonsense/.test(e.message))
  await store.remove('settings', 'k0')
  assert.equal(await store.get('settings', 'k0'), null)
  for (let n = 1; n <= 650; n++) await db.insert('settings', setting(n))
  const keys = (await store.list('settings')).map((s) => s.setting_key)
  assert.equal(keys.length, 650)
  assert.equal(new Set(keys).size, 650)
})
