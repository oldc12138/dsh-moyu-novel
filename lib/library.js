/**
 * The on-disk library used by both halves of the plugin.
 *
 * Layout (one directory per book, no global index file to keep in sync):
 *
 *   <root>/books/<id>/meta.json      title, author, chapter titles, progress
 *   <root>/books/<id>/ch/0001.txt    chapter body, 0-based on disk, 1-based name
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const ID_RE = /^[a-z0-9]{6,40}$/

export function isValidId(id) {
  return typeof id === 'string' && ID_RE.test(id)
}

function newId() {
  return `b${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`
}

function chapterFile(index) {
  return `${String(index).padStart(4, '0')}.txt`
}

export class Library {
  constructor(root) {
    this.root = root
  }

  booksDir() {
    return path.join(this.root, 'books')
  }

  bookDir(id) {
    return path.join(this.booksDir(), id)
  }

  async ensure() {
    await fs.mkdir(this.booksDir(), { recursive: true })
  }

  async readMeta(id) {
    if (!isValidId(id)) return null
    try {
      return JSON.parse(await fs.readFile(path.join(this.bookDir(id), 'meta.json'), 'utf8'))
    } catch {
      return null
    }
  }

  async writeMeta(meta) {
    const dir = this.bookDir(meta.id)
    await fs.mkdir(path.join(dir, 'ch'), { recursive: true })
    const file = path.join(dir, 'meta.json')
    const tmp = `${file}.tmp`
    await fs.writeFile(tmp, JSON.stringify(meta, null, 2), 'utf8')
    await fs.rename(tmp, file)
  }

  /**
   * Create a book and write its chapters.
   * @param {{ title: string, author?: string, source?: string, chapters: { title: string, text: string }[] }} input
   */
  async create(input) {
    await this.ensure()
    const meta = {
      id: newId(),
      title: (input.title || '未命名').slice(0, 120),
      author: (input.author || '').slice(0, 80),
      source: input.source || 'text',
      addedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      chapters: [],
      progress: { chapter: 0, ratio: 0 },
    }
    await fs.mkdir(path.join(this.bookDir(meta.id), 'ch'), { recursive: true })
    for (const chapter of input.chapters) {
      meta.chapters.push({ title: chapter.title.slice(0, 120) })
    }
    await this.writeChapters(meta.id, input.chapters)
    await this.writeMeta(meta)
    return meta
  }

  async writeChapters(id, chapters) {
    const dir = path.join(this.bookDir(id), 'ch')
    await fs.mkdir(dir, { recursive: true })
    for (let index = 0; index < chapters.length; index += 1) {
      const text = chapters[index].text ?? ''
      await fs.writeFile(path.join(dir, chapterFile(index)), text, 'utf8')
    }
  }

  async readChapter(id, index) {
    if (!Number.isInteger(index) || index < 0) return null
    const meta = await this.readMeta(id)
    if (meta === null || index >= meta.chapters.length) return null
    try {
      const text = await fs.readFile(path.join(this.bookDir(id), 'ch', chapterFile(index)), 'utf8')
      return { index, title: meta.chapters[index].title, text }
    } catch {
      return { index, title: meta.chapters[index].title, text: '' }
    }
  }

  async saveProgress(id, chapter, ratio) {
    const meta = await this.readMeta(id)
    if (meta === null) return null
    const bounded = Math.max(0, Math.min(meta.chapters.length - 1, Math.round(chapter)))
    meta.progress = {
      chapter: Number.isFinite(bounded) ? bounded : 0,
      ratio: Math.max(0, Math.min(1, Number(ratio) || 0)),
      updatedAt: new Date().toISOString(),
    }
    meta.updatedAt = new Date().toISOString()
    await this.writeMeta(meta)
    return meta.progress
  }

  async list() {
    await this.ensure()
    let entries = []
    try {
      entries = await fs.readdir(this.booksDir(), { withFileTypes: true })
    } catch {
      return []
    }
    const books = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !isValidId(entry.name)) continue
      const meta = await this.readMeta(entry.name)
      if (meta === null) continue
      books.push({
        id: meta.id,
        title: meta.title,
        author: meta.author ?? '',
        source: meta.source ?? '',
        chapters: meta.chapters.length,
        progress: meta.progress ?? { chapter: 0, ratio: 0 },
        addedAt: meta.addedAt,
        updatedAt: meta.updatedAt,
        cached: meta.cached ?? null,
      })
    }
    books.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    return books
  }

  async remove(id) {
    if (!isValidId(id)) return false
    await fs.rm(this.bookDir(id), { recursive: true, force: true })
    return true
  }
}
