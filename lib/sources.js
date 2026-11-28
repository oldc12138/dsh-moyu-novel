/**
 * Where books come from: the local disk, URLs, and the `dsh-novel` cache.
 *
 * The dsh-novel cache is the interesting one. That plugin writes the full
 * chapter text of everything it has fetched to
 * `~/.dsh/novel/cache/content/<sourceId>-<encodedBookKey>-<index>-<hash>.txt`
 * and the table of contents to `.../toc/…json`, while `shelf.json` holds the
 * readable titles. This module maps that naming scheme back to books, so a
 * reader may import what an agent already downloaded.
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const MAX_FETCH_BYTES = 12 * 1024 * 1024

export function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

export function novelRoot() {
  return path.join(dshHome(), 'novel')
}

export function cacheRoot() {
  return path.join(novelRoot(), 'cache')
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Whether the third-party dsh-novel plugin left a shelf on this machine.
 * A fresh profile has none, and the UI must not send that user into a dead
 * end ("import from dsh-novel" with nothing to import).
 */
export async function hasNovelCache() {
  try {
    await fs.access(path.join(novelRoot(), 'shelf.json'))
    return true
  } catch {
    return false
  }
}

/** Books the dsh-novel plugin has on its shelf, newest first. */
export async function readNovelShelf() {
  const shelf = await readJson(path.join(novelRoot(), 'shelf.json'))
  if (!Array.isArray(shelf)) return []
  return shelf
    .filter((row) => row && typeof row.bookKey === 'string')
    .map((row) => ({
      title: String(row.title ?? '').trim(),
      bookKey: row.bookKey,
      sourceId: String(row.sourceId ?? ''),
      totalChapters: Number(row.totalChapters) || 0,
      chapterIndex: Number(row.progress?.chapterIndex) || 0,
      addedAt: Number(row.addedAt) || 0,
    }))
}

function cachePrefix(sourceId, bookKey) {
  return `${sourceId}-${encodeURIComponent(bookKey)}-`
}

/** Table of contents cached for one shelf entry, or null when absent. */
export async function readCachedToc(sourceId, bookKey) {
  const prefix = cachePrefix(sourceId, bookKey)
  let names = []
  try {
    names = await fs.readdir(path.join(cacheRoot(), 'toc'))
  } catch {
    return null
  }
  const hit = names.find((name) => name.startsWith(prefix) && name.endsWith('.json'))
  if (!hit) return null
  const toc = await readJson(path.join(cacheRoot(), 'toc', hit))
  if (!Array.isArray(toc)) return null
  return toc.map((row) => ({ name: String(row?.name ?? ''), url: String(row?.url ?? '') }))
}

/**
 * Full chapter text already cached by dsh-novel.
 * @returns {Promise<string | null>} null when that chapter was never fetched
 */
export async function readCachedChapter(sourceId, bookKey, index) {
  const prefix = cachePrefix(sourceId, bookKey)
  const dir = path.join(cacheRoot(), 'content')
  let names = []
  try {
    names = await fs.readdir(dir)
  } catch {
    return null
  }
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)-[^/]*\\.txt$`)
  const hit = names.find((name) => {
    const match = pattern.exec(name)
    return match !== null && Number(match[1]) === index
  })
  if (!hit) return null
  try {
    return await fs.readFile(path.join(dir, hit), 'utf8')
  } catch {
    return null
  }
}

function decodeBuffer(buffer, contentType) {
  let charset = ''
  const fromHeader = /charset=([\w-]+)/i.exec(contentType || '')
  if (fromHeader) charset = fromHeader[1].toLowerCase()
  if (charset === '') {
    const head = buffer.toString('latin1', 0, Math.min(buffer.length, 4096))
    const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)
    if (fromMeta) charset = fromMeta[1].toLowerCase()
  }
  const candidates = [charset, 'utf-8', 'gb18030'].filter((value) => value !== '')
  for (const label of candidates) {
    try {
      return new TextDecoder(label, { fatal: false }).decode(buffer)
    } catch {
      continue
    }
  }
  return buffer.toString('utf8')
}

/** Fetch a URL with a browser UA, a timeout, and a hard size ceiling. */
export async function fetchResource(url, { timeoutMs = 20000, as = 'text' } = {}) {
  const target = new URL(url)
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error(`仅支持 http(s) 地址：${url}`)
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(target, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        accept: as === 'text' ? 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5' : '*/*',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.6',
      },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
    const length = Number(response.headers.get('content-length') || 0)
    if (length > MAX_FETCH_BYTES) throw new Error(`文件过大（${length} 字节），上限 ${MAX_FETCH_BYTES}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > MAX_FETCH_BYTES) throw new Error(`文件过大（${buffer.length} 字节），上限 ${MAX_FETCH_BYTES}`)
    if (as === 'buffer') return { buffer, contentType: response.headers.get('content-type') || '' }
    return { text: decodeBuffer(buffer, response.headers.get('content-type') || ''), contentType: response.headers.get('content-type') || '' }
  } finally {
    clearTimeout(timer)
  }
}
