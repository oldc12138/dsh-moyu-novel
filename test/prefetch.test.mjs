/**
 * The background queue: pacing, persistence, pause/resume, give-up behaviour.
 * The chapter fetch is injected, so nothing here touches the network.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Prefetch } from '../lib/prefetch.js'

const results = []
async function test(name, fn) {
  try {
    await fn()
    results.push({ name, ok: true })
  } catch (error) {
    results.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/** A library stand-in: one book, chapters appended by the fake downloader. */
async function makeLibrary(chapters = 0) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moyu-prefetch-'))
  const meta = {
    id: 'bmtest000001',
    title: '测试书',
    chapters: Array.from({ length: chapters }, (_, i) => ({ title: `第${i + 1}章` })),
    progress: { chapter: 0, ratio: 0 },
  }
  return {
    root,
    meta,
    async readMeta(id) {
      if (id !== meta.id || meta.gone) return null
      return JSON.parse(JSON.stringify(meta))
    },
  }
}

const waitFor = async (check, timeout = 3000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await check()) return true
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return false
}

const fast = { gapMs: 0, restMs: 0, batchSize: 2, cooldownMs: 0 }

await test('drains the queue and deletes its file', async () => {
  const library = await makeLibrary(0)
  let calls = 0
  const download = async (_library, { chapters }) => {
    calls += 1
    library.meta.chapters.push({ title: chapters[0].title })
    return { book: library.meta, added: 1, failures: [], remaining: [], skipped: 0 }
  }
  const prefetch = new Prefetch(library, { ...fast, download })
  const queued = await prefetch.enqueue({
    bookId: 'bmtest000001',
    chapters: Array.from({ length: 5 }, (_, i) => ({ title: `第${i + 1}章`, url: `https://example.test/${i + 1}` })),
  })
  assert.equal(queued, 5)
  assert.equal(prefetch.status()[0].pending, 5)
  await waitFor(() => prefetch.status().length === 0)
  assert.equal(calls, 5)
  assert.deepEqual(prefetch.status(), [])
  // The file is unlinked after the map entry, so give it a moment too.
  await waitFor(async () => (await fs.readdir(path.join(library.root, 'queue')).catch(() => [])).length === 0)
  const left = await fs.readdir(path.join(library.root, 'queue')).catch(() => [])
  assert.deepEqual(left, [], 'queue file should be gone')
  prefetch.dispose()
})

await test('skips chapters the book already has', async () => {
  const library = await makeLibrary(2)
  const prefetch = new Prefetch(library, { ...fast, download: async () => ({ added: 0, failures: [], remaining: [] }) })
  const queued = await prefetch.enqueue({
    bookId: 'bmtest000001',
    chapters: [
      { title: '第1章', url: 'https://example.test/a' },
      { title: '第2章', url: 'https://example.test/b' },
      { title: '第3章', url: 'https://example.test/c' },
    ],
  })
  assert.equal(queued, 1, 'only the new chapter should be queued')
  prefetch.dispose()
})

await test('pause stops the queue, resume finishes it', async () => {
  const library = await makeLibrary(0)
  let calls = 0
  let resolveGate = null
  const download = async (_library, { chapters }) => {
    calls += 1
    library.meta.chapters.push({ title: chapters[0].title })
    if (resolveGate !== null) await resolveGate
    return { book: library.meta, added: 1, failures: [], remaining: [], skipped: 0 }
  }
  const prefetch = new Prefetch(library, { ...fast, gapMs: 60, download })
  await prefetch.enqueue({
    bookId: 'bmtest000001',
    chapters: Array.from({ length: 4 }, (_, i) => ({ title: `第${i + 1}章`, url: `https://example.test/${i}` })),
  })
  await waitFor(() => calls >= 1)
  await prefetch.pause('bmtest000001')
  const frozen = calls
  await new Promise((resolve) => setTimeout(resolve, 200))
  assert.equal(calls, frozen, 'paused queue must not call the downloader')
  assert.equal(prefetch.status()[0].paused, true)
  await prefetch.resume('bmtest000001')
  await waitFor(() => prefetch.status().length === 0)
  assert.equal(library.meta.chapters.length, 4)
  prefetch.dispose()
})

await test('gives up on a chapter after repeated failures and keeps going', async () => {
  const library = await makeLibrary(0)
  let n = 0
  const download = async (_library, { chapters }) => {
    n += 1
    if (chapters[0].title === '第2章') {
      return { added: 0, failures: [{ url: chapters[0].url, reason: 'HTTP 400' }], remaining: [chapters[0].url] }
    }
    library.meta.chapters.push({ title: chapters[0].title })
    return { book: library.meta, added: 1, failures: [], remaining: [], skipped: 0 }
  }
  const prefetch = new Prefetch(library, { ...fast, giveUpAfter: 2, download })
  await prefetch.enqueue({
    bookId: 'bmtest000001',
    chapters: [1, 2, 3].map((i) => ({ title: `第${i}章`, url: `https://example.test/${i}` })),
  })
  await waitFor(() => prefetch.status().length === 0)
  assert.deepEqual(library.meta.chapters.map((c) => c.title), ['第1章', '第3章'])
  assert.ok(n >= 4, `expected retries, saw ${n} calls`)
  prefetch.dispose()
})

await test('a deleted book cancels its queue', async () => {
  const library = await makeLibrary(0)
  const download = async () => { throw new Error('书不存在：bmtest000001') }
  const prefetch = new Prefetch(library, { ...fast, download })
  await prefetch.enqueue({
    bookId: 'bmtest000001',
    chapters: [{ title: '第1章', url: 'https://example.test/1' }],
  })
  await waitFor(() => prefetch.status().length === 0)
  assert.deepEqual(prefetch.status(), [])
  prefetch.dispose()
})

const failed = results.filter((row) => !row.ok)
for (const row of results) console.log(`${row.ok ? 'PASS' : 'FAIL'}  ${row.name}${row.ok ? '' : `\n      ${row.error}`}`)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length > 0) process.exitCode = 1
