/**
 * Import/download invariants: a second import must refresh instead of cloning,
 * a bad bookId must fail loudly, and a stopped batch must keep every chapter it
 * did fetch plus hand back the whole tail (the failed chapter included).
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moyu-import-'))
process.env.DSH_HOME = path.join(dir, 'dsh')

const { Library } = await import('../lib/library.js')
const { downloadChapters, importNovelCache } = await import('../lib/importers.js')

const sourceId = 'src-test'
const bookKey = 'https://example.test/book/1.html'
const cacheRoot = path.join(process.env.DSH_HOME, 'novel', 'cache')
const prefix = `${sourceId}-${encodeURIComponent(bookKey)}-`

await fs.mkdir(path.join(cacheRoot, 'toc'), { recursive: true })
await fs.mkdir(path.join(cacheRoot, 'content'), { recursive: true })
await fs.writeFile(path.join(cacheRoot, 'toc', `${prefix}abc.json`), JSON.stringify([
  { name: '第一章', url: 'https://example.test/1' },
  { name: '第二章', url: 'https://example.test/2' },
  { name: '第三章', url: 'https://example.test/3' },
]), 'utf8')
await fs.writeFile(path.join(cacheRoot, 'content', `${prefix}0-abc.txt`), '第一章正文', 'utf8')
await fs.writeFile(path.join(cacheRoot, 'content', `${prefix}1-abc.txt`), '第二章正文', 'utf8')

const library = new Library(path.join(dir, 'lib'))

/* 1. importing the same dsh-novel book twice refreshes it, never clones it */
const first = await importNovelCache(library, { bookKey, sourceId, title: '缓存书' })
assert.equal(first.missing, 1, 'one chapter was never cached')
const second = await importNovelCache(library, { bookKey, sourceId })
assert.equal(second.book.id, first.book.id, 'the second import must reuse the same book id')
assert.equal(second.merged, true)
assert.equal(second.filled, 0, 'nothing new to fill yet')
assert.equal((await library.list()).length, 1, 'still one book on the shelf')

/* 2. a chapter that dsh-novel caches later is filled into the same book */
await fs.writeFile(path.join(cacheRoot, 'content', `${prefix}2-abc.txt`), '第三章正文', 'utf8')
const third = await importNovelCache(library, { bookKey, sourceId })
assert.equal(third.book.id, first.book.id)
assert.equal(third.missing, 0)
assert.equal(third.filled, 1)
assert.equal((await library.readChapter(first.book.id, 2)).text, '第三章正文')
const meta = await library.readMeta(first.book.id)
assert.equal(meta.bookKey, bookKey, 'the identity is stored for the next import')

/* 3. an unknown bookId must throw instead of quietly creating a second copy */
await assert.rejects(
  () => downloadChapters(library, { bookId: 'missing123', chapters: [{ url: 'https://example.test/x' }] }),
  /书不存在/,
)

/* 4. download: chapters are persisted one by one, a failed one stays pending */
const page = (title, body) => `<html><head><title>${title}</title></head><body><div id="content">${body.repeat(30)}</div></body></html>`
const pages = new Map([
  ['https://example.test/c1', page('第 1 章', '正文一。')],
  ['https://example.test/c3', page('第 3 章', '正文三。')],
])
const stub = (url) => {
  const html = pages.get(String(url))
  if (html === undefined) {
    return { ok: false, status: 404, statusText: 'Not Found', headers: { get: () => null } }
  }
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name) => {
        const key = String(name).toLowerCase()
        if (key === 'content-length') return String(Buffer.byteLength(html))
        if (key === 'content-type') return 'text/html; charset=utf-8'
        return null
      },
    },
    arrayBuffer: async () => new TextEncoder().encode(html).buffer,
  }
}
globalThis.fetch = async (url) => stub(url)

const run = await downloadChapters(library, {
  title: '下载书',
  chapters: [
    { title: '第 1 章', url: 'https://example.test/c1' },
    { title: '第 2 章', url: 'https://example.test/c2' },
    { title: '第 3 章', url: 'https://example.test/c3' },
  ],
  delayMs: 0,
})
assert.equal(run.added, 2, 'the two reachable chapters are saved')
assert.equal(run.failures.length, 1)
assert.deepEqual(run.remaining, ['https://example.test/c2'], 'the failed chapter is handed back for a retry')
const downloaded = await library.readMeta(run.book.id)
assert.deepEqual(downloaded.chapters.map((chapter) => chapter.title), ['第 1 章', '第 3 章'])
assert.match((await library.readChapter(downloaded.id, 1)).text, /正文三/, 'the fetched text is on disk')

/* 5. rate limit: one cooldown, then stop with the whole tail — nothing lost */
pages.set('https://example.test/c2', page('第 2 章', '正文二。'))
globalThis.fetch = async () => ({ ok: false, status: 429, statusText: 'Too Many Requests', headers: { get: () => null } })
const blocked = await downloadChapters(library, {
  bookId: downloaded.id,
  chapters: [
    { title: '第 4 章', url: 'https://example.test/c4' },
    { title: '第 5 章', url: 'https://example.test/c5' },
  ],
  delayMs: 0,
  cooldownMs: 1,
})
assert.equal(blocked.added, 0)
assert.deepEqual(blocked.remaining, ['https://example.test/c4', 'https://example.test/c5'])
assert.equal((await library.readMeta(downloaded.id)).chapters.length, 2, 'a blocked batch adds nothing')

/* 6. resuming from first remaining fills the gap without touching progress */
globalThis.fetch = async (url) => stub(url)
const resumed = await downloadChapters(library, {
  bookId: downloaded.id,
  chapters: [{ title: '第 2 章', url: 'https://example.test/c2' }],
  delayMs: 0,
})
assert.equal(resumed.added, 1)
const after = await library.readMeta(downloaded.id)
assert.deepEqual(after.chapters.map((chapter) => chapter.title), ['第 1 章', '第 3 章', '第 2 章'])
assert.deepEqual(after.progress, { chapter: 0, ratio: 0 }, 'progress stays untouched')

await fs.rm(dir, { recursive: true, force: true })
console.log('11 assertions passed')
