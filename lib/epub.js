/**
 * EPUB import without third-party dependencies.
 *
 * A ZIP central-directory reader (stored + deflate entries, `node:zlib`
 * only), then the OPF spine decides reading order. Chapter titles come from
 * the document's own heading, its <title>, or the file name.
 */
import { inflateRawSync } from 'node:zlib'
import { decodeEntities, extractMainText, parseDocument, queryFirst, textOf } from './html.js'

const SIG_EOCD = 0x06054b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50

function readUInt16(buffer, offset) {
  return buffer.readUInt16LE(offset)
}

function readUInt32(buffer, offset) {
  return buffer.readUInt32LE(offset)
}

/** Read every entry of a ZIP archive into a name → bytes map. */
export /** Refuse archives that expand past this: a zip bomb must not OOM the Host. */
const MAX_ENTRY_BYTES = 64 * 1024 * 1024
const MAX_TOTAL_BYTES = 256 * 1024 * 1024

function readZip(buffer) {
  const maxBack = Math.min(buffer.length, 0xffff + 22)
  let eocd = -1
  for (let i = buffer.length - 22; i >= buffer.length - maxBack; i -= 1) {
    if (i < 0) break
    if (readUInt32(buffer, i) === SIG_EOCD) {
      eocd = i
      break
    }
  }
  if (eocd === -1) throw new Error('zip: end of central directory not found')

  const count = readUInt16(buffer, eocd + 10)
  const directoryOffset = readUInt32(buffer, eocd + 16)
  const files = new Map()
  let expanded = 0
  let cursor = directoryOffset

  for (let i = 0; i < count; i += 1) {
    if (readUInt32(buffer, cursor) !== SIG_CENTRAL) throw new Error('zip: bad central directory entry')
    const method = readUInt16(buffer, cursor + 10)
    const compressedSize = readUInt32(buffer, cursor + 20)
    const nameLength = readUInt16(buffer, cursor + 28)
    const extraLength = readUInt16(buffer, cursor + 30)
    const commentLength = readUInt16(buffer, cursor + 32)
    const localOffset = readUInt32(buffer, cursor + 42)
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength)
    cursor += 46 + nameLength + extraLength + commentLength

    if (name.endsWith('/')) continue
    if (readUInt32(buffer, localOffset) !== SIG_LOCAL) throw new Error(`zip: bad local header for ${name}`)
    const localNameLength = readUInt16(buffer, localOffset + 26)
    const localExtraLength = readUInt16(buffer, localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const data = buffer.subarray(dataStart, dataStart + compressedSize)
    if (method === 0) {
      files.set(name, data)
      expanded += data.length
    } else if (method === 8) {
      files.set(name, inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES }))
      expanded += files.get(name).length
    } else {
      throw new Error(`zip: unsupported compression method ${method} for ${name}`)
    }
    if (expanded > MAX_TOTAL_BYTES) throw new Error('zip: 解压后体积过大，已拒绝')
  }

  return files
}

function resolvePath(base, href) {
  const clean = href.split('#')[0]
  const stack = base === '' ? [] : base.split('/')
  for (const piece of clean.split('/')) {
    if (piece === '' || piece === '.') continue
    if (piece === '..') stack.pop()
    else stack.push(piece)
  }
  return stack.join('/')
}

function dirOf(path) {
  const index = path.lastIndexOf('/')
  return index === -1 ? '' : path.slice(0, index)
}

function attr(tagSource, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tagSource)
  if (match === null) return undefined
  return decodeEntities(match[2] ?? match[3] ?? '')
}

/** Title candidates inside one XHTML document, best first. */
function documentTitle(xhtml, fallback) {
  const root = parseDocument(xhtml)
  for (const selector of ['h1', 'h2', 'h3', 'title']) {
    const node = queryFirst(root, selector)
    if (node === null) continue
    const text = textOf(node).replace(/\s+/g, ' ').trim()
    if (text !== '' && text.length <= 80) return text
  }
  return fallback
}

/**
 * Read an EPUB buffer into chapters.
 * @returns {{ title: string, author: string, chapters: { title: string, text: string }[] }}
 */
export function readEpub(buffer) {
  const files = readZip(buffer)
  const text = (name) => files.get(name)?.toString('utf8') ?? ''

  const container = text('META-INF/container.xml')
  const rootfileMatch = /<rootfile\b[^>]*>/i.exec(container)
  const opfPath = rootfileMatch === null ? null : attr(rootfileMatch[0], 'full-path')

  const candidates = []
  let title = ''
  let author = ''

  if (opfPath) {
    const opf = text(opfPath)
    const manifest = new Map()
    for (const match of opf.matchAll(/<item\b[^>]*>/gi)) {
      const id = attr(match[0], 'id')
      const href = attr(match[0], 'href')
      if (id && href) manifest.set(id, resolvePath(dirOf(opfPath), href))
    }
    for (const match of opf.matchAll(/<itemref\b[^>]*>/gi)) {
      const idref = attr(match[0], 'idref')
      const target = idref ? manifest.get(idref) : undefined
      if (target) candidates.push(target)
    }
    const titleMatch = /<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/i.exec(opf)
    if (titleMatch) title = decodeEntities(titleMatch[1]).replace(/\s+/g, ' ').trim()
    const authorMatch = /<dc:creator\b[^>]*>([\s\S]*?)<\/dc:creator>/i.exec(opf)
    if (authorMatch) author = decodeEntities(authorMatch[1]).replace(/\s+/g, ' ').trim()
  }

  if (candidates.length === 0) {
    for (const name of files.keys()) {
      if (/\.x?html?$/i.test(name)) candidates.push(name)
    }
    candidates.sort()
  }

  const chapters = []
  for (const name of candidates) {
    const xhtml = text(name)
    if (xhtml.trim() === '') continue
    const body = extractMainText(xhtml)
    if (body.length < 20) continue
    const fallback = name.replace(/^.*\//, '').replace(/\.x?html?$/i, '')
    chapters.push({ title: documentTitle(xhtml, fallback), text: body })
  }

  return { title, author, chapters }
}
