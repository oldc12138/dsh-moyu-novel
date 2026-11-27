/**
 * Host-half test: applies the plugin to a stub context, then checks that the
 * HTTP route is mounted once the web server service appears (the case that
 * silently produced HTTP 404 before) and that the tools answer.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moyu-host-'))
const { apply } = await import('../index.js')

const tools = new Map()
const pending = []
let route = null

const ctx = {
  effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
  get(name) {
    if (name === 'webServer' && route !== null) return { register(r) { route = r; return () => { route = null } } }
    return undefined
  },
  inject(deps, callback) { pending.push({ deps, callback }) },
  tools: { register(def) { tools.set(def.name, def); return () => tools.delete(def.name) } },
  logger: { warn() {} },
}

apply(ctx, { libraryDir: path.join(dir, 'lib') })
console.log('tools registered:', [...tools.keys()].sort().join(', '))
console.log('webServer was absent at apply time, deferred:', pending.length === 1)

// Simulate the carrier coming up later: the inject callback must run then.
assert.equal(route, null)
const hostCtx = {
  ...ctx,
  get: (name) => (name === 'webServer'
    ? { register(r) { route = r; return () => { route = null } } }
    : undefined),
}
pending[0].callback(hostCtx)
console.log('route mounted after service appeared:', route?.path === '/moyu-novel', route?.kind === 'prefix')

/* exercise the route */
const makeRes = () => ({ status: 0, body: '', writeHead(s) { this.status = s }, end(b) { this.body = String(b ?? '') } })
const makeReq = (method, url, body) => {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  setTimeout(() => {
    if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)))
    req.emit('end')
  }, 0)
  return req
}
const call = async (method, url, body) => {
  const res = makeRes()
  await route.handler(makeReq(method, url, body), res)
  return { status: res.status, json: res.body ? JSON.parse(res.body) : null }
}

const empty = await call('GET', '/moyu-novel/api/library')
console.log('GET library:', empty.status, JSON.stringify(empty.json))

const imported = await tools.get('moyu_novel_import').execute({
  source: 'text',
  title: '测试书',
  text: '第一章 起\n正文一。\n第二章 承\n正文二。',
})
console.log('import:', imported.chapters, 'chapters')

const listed = await call('GET', '/moyu-novel/api/library')
console.log('library after import:', listed.status, listed.json.books.length, listed.json.books[0].chapters)

const chapter = await call('GET', `/moyu-novel/api/chapter?id=${imported.id}&index=1`)
console.log('chapter:', chapter.status, chapter.json.title, JSON.stringify(chapter.json.text))

const progress = await call('POST', '/moyu-novel/api/progress', { id: imported.id, chapter: 1, ratio: 0.5 })
console.log('progress:', progress.status, JSON.stringify(progress.json))

const bad = await call('GET', '/moyu-novel/api/book?id=../../etc/passwd')
console.log('traversal blocked:', bad.status)

await fs.rm(dir, { recursive: true, force: true })
console.log('OK')
