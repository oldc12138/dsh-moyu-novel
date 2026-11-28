/**
 * Background chapter prefetch.
 *
 * A whole book cannot be fetched inside one tool call: the site rate-limits, the
 * agent turn would run for hours, and the reader would sit waiting. So the first
 * chapters are fetched immediately and the tail lands here — one chapter at a
 * time, far slower than a person reads, with a rest after every batch and an
 * exponential backoff when the site pushes back.
 *
 * The pace is deliberately unimpressive: a chapter takes roughly eight minutes
 * to read, and ten seconds to fetch, so the queue stays ~48x ahead of the reader
 * and the source sees a polite trickle instead of a scrape.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { downloadChapters } from './importers.js'

export const PREFETCH_DEFAULTS = {
  /** One chapter every ten seconds. */
  gapMs: 10_000,
  /** Rest this many chapters. */
  batchSize: 50,
  /** How long to rest between batches. */
  restMs: 90_000,
  /** The site's own cooldown, reused when a chapter is rejected. */
  cooldownMs: 70_000,
  /** After this many failures in a row, stop and wait for a resume. */
  giveUpAfter: 4,
  /** How long a queue waits after giving up before trying again on its own. */
  coolDownAfterGiveUpMs: 10 * 60_000,
}

export class Prefetch {
  constructor(library, options = {}) {
    this.library = library
    this.options = { ...PREFETCH_DEFAULTS, ...options }
    /** bookId → queue record */
    this.queues = new Map()
    this.timer = null
    this.stopped = false
    this.busyBook = ''
    this.log = typeof options.log === 'function' ? options.log : () => {}
    /** Injectable so the queue can be tested without touching the network. */
    this.download = typeof options.download === 'function' ? options.download : downloadChapters
  }

  dir() {
    return path.join(this.library.root, 'queue')
  }

  file(bookId) {
    return path.join(this.dir(), `${bookId}.json`)
  }

  /** Pick up queues left behind by the previous run. */
  async restore() {
    let names = []
    try {
      names = await fs.readdir(this.dir())
    } catch {
      return
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      try {
        const queue = JSON.parse(await fs.readFile(path.join(this.dir(), name), 'utf8'))
        if (typeof queue?.bookId !== 'string' || !Array.isArray(queue.pending)) continue
        if (queue.pending.length === 0) {
          await fs.rm(this.file(queue.bookId), { force: true })
          continue
        }
        // A fresh process gets a fresh attempt budget.
        queue.failures = 0
        this.queues.set(queue.bookId, queue)
      } catch {
        await fs.rm(path.join(this.dir(), name), { force: true })
      }
    }
    if (this.queues.size > 0) {
      this.log(`恢复 ${this.queues.size} 个后台下载队列`)
      this.schedule(0)
    }
  }

  /**
   * Add chapters to a book's queue. Chapters already in the book, or already
   * queued, are skipped, so calling this twice is harmless.
   * @returns {Promise<number>} how many chapters were queued
   */
  async enqueue({ bookId, title, chapters }) {
    if (typeof bookId !== 'string' || bookId === '') throw new Error('缺少书 id')
    const meta = await this.library.readMeta(bookId)
    if (meta === null) throw new Error(`书不存在：${bookId}`)
    const queue = this.queues.get(bookId) ?? {
      bookId,
      title: title ?? meta.title ?? '',
      pending: [],
      done: 0,
      failed: [],
      failures: 0,
      paused: false,
      lastError: '',
      updatedAt: new Date().toISOString(),
    }
    const have = new Set(meta.chapters.map((chapter) => String(chapter.title)))
    const queued = new Set(queue.pending.map((chapter) => String(chapter.url)))
    let added = 0
    for (const entry of chapters) {
      const url = typeof entry === 'string' ? entry : String(entry?.url ?? '')
      if (url === '' || queued.has(url)) continue
      const name = typeof entry === 'string' ? '' : String(entry?.title ?? '')
      if (name !== '' && have.has(name)) continue
      queue.pending.push({ title: name, url })
      queued.add(url)
      added += 1
    }
    if (added === 0) return 0
    queue.paused = false
    queue.failures = 0
    queue.lastError = ''
    queue.updatedAt = new Date().toISOString()
    this.queues.set(bookId, queue)
    await this.save(queue)
    this.schedule(0)
    return added
  }

  status(bookId) {
    const rows = []
    for (const queue of this.queues.values()) {
      if (bookId && queue.bookId !== bookId) continue
      rows.push({
        bookId: queue.bookId,
        title: queue.title ?? '',
        pending: queue.pending.length,
        done: queue.done ?? 0,
        failed: (queue.failed ?? []).length,
        paused: queue.paused === true,
        lastError: queue.lastError ?? '',
      })
    }
    return rows
  }

  async pause(bookId) {
    const queue = this.queues.get(bookId)
    if (!queue) return false
    queue.paused = true
    queue.updatedAt = new Date().toISOString()
    await this.save(queue)
    return true
  }

  async resume(bookId) {
    const queue = this.queues.get(bookId)
    if (!queue) return false
    queue.paused = false
    queue.failures = 0
    queue.lastError = ''
    queue.updatedAt = new Date().toISOString()
    await this.save(queue)
    this.schedule(0)
    return true
  }

  async cancel(bookId) {
    if (!this.queues.has(bookId)) return false
    this.queues.delete(bookId)
    await fs.rm(this.file(bookId), { force: true })
    return true
  }

  dispose() {
    this.stopped = true
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /* ------------------------------------------------------------ internals */

  async save(queue) {
    await fs.mkdir(this.dir(), { recursive: true })
    queue.updatedAt = new Date().toISOString()
    await fs.writeFile(this.file(queue.bookId), JSON.stringify(queue), 'utf8')
  }

  /** The queue that waited longest and is allowed to run right now. */
  pick() {
    let best = null
    for (const queue of this.queues.values()) {
      if (queue.paused === true || queue.pending.length === 0) continue
      if (queue.notBefore && Date.now() < queue.notBefore) continue
      if (best === null || (queue.notBefore ?? 0) < (best.notBefore ?? 0)) best = queue
    }
    return best
  }

  schedule(ms) {
    if (this.stopped || this.timer !== null) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.step().catch((error) => {
        this.log(`后台下载出错：${error instanceof Error ? error.message : String(error)}`)
        this.schedule(this.options.restMs)
      })
    }, Math.max(0, ms))
  }

  async step() {
    const queue = this.pick()
    if (!queue) {
      // Nothing due; look again when the earliest cooldown expires.
      const next = [...this.queues.values()]
        .filter((item) => item.paused !== true && item.pending.length > 0 && item.notBefore)
        .map((item) => item.notBefore - Date.now())
      if (next.length > 0) this.schedule(Math.max(1_000, Math.min(...next)))
      return
    }

    const chapter = queue.pending[0]
    let result = null
    try {
      result = await this.download(this.library, {
        bookId: queue.bookId,
        chapters: [{ title: chapter.title, url: chapter.url }],
        delayMs: 0,
        cooldownMs: this.options.cooldownMs,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // The book is gone: the queue has nothing to append to.
      if (message.includes('书不存在')) {
        this.queues.delete(queue.bookId)
        await fs.rm(this.file(queue.bookId), { force: true })
        this.log(`队列取消（${message}）`)
        return
      }
      queue.lastError = message
    }

    const ok = result !== null && (result.added > 0 || result.remaining.length === 0)
    if (ok) {
      queue.pending.shift()
      queue.done = (queue.done ?? 0) + 1
      queue.failures = 0
      queue.lastError = ''
    } else {
      queue.failures = (queue.failures ?? 0) + 1
      queue.lastError = result?.failures?.[0]?.reason ?? queue.lastError ?? '站点拒绝了请求'
      if (queue.failures >= this.options.giveUpAfter) {
        // Keep the chapter: a later resume retries it.
        queue.pending.shift()
        queue.failed = [...(queue.failed ?? []), chapter].slice(-50)
        queue.failures = 0
      }
    }

    if (queue.pending.length === 0) {
      this.queues.delete(queue.bookId)
      await fs.rm(this.file(queue.bookId), { force: true })
      this.log(`《${queue.title ?? queue.bookId}》后台下载完成，共 ${queue.done ?? 0} 章`)
      this.schedule(0)
      return
    }

    await this.save(queue)
    const percent = (queue.done ?? 0) > 0 && (queue.done ?? 0) % this.options.batchSize === 0
    if (percent) this.log(`《${queue.title ?? queue.bookId}》已补 ${queue.done} 章，休息 ${Math.round(this.options.restMs / 1000)}s`)
    this.schedule(percent ? this.options.restMs : this.options.gapMs)
  }
}
