/**
 * Minimal HTML parsing and readable-text extraction.
 *
 * Deliberately dependency-free: the bundle is hand-written ESM, and a plugin
 * that drags in a parser dependency cannot be installed from a linked
 * directory without a package install step. The subset here covers what
 * chapter pages actually use: elements, attributes, text, comments,
 * raw-text elements, and a small selector dialect (tag / #id / .class /
 * descendants), plus a readable-region heuristic for whole pages.
 */

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
])

const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'template'])

const BLOCK_ELEMENTS = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'dd', 'div', 'dl', 'dt',
  'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table',
  'tbody', 'td', 'th', 'tr', 'ul',
])

const SKIP_TEXT_ELEMENTS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'head'])

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  mdash: '\u2014', ndash: '\u2013', hellip: '\u2026', middot: '\u00b7',
  ldquo: '\u201c', rdquo: '\u201d', lsquo: '\u2018', rsquo: '\u2019',
  laquo: '\u00ab', raquo: '\u00bb', copy: '\u00a9', reg: '\u00ae',
  ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009', times: '\u00d7',
}

export function decodeEntities(input) {
  if (!input || input.indexOf('&') === -1) return input
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole
      try { return String.fromCodePoint(code) } catch { return whole }
    }
    const named = ENTITIES[body.toLowerCase()]
    return named === undefined ? whole : named
  })
}

function parseAttributes(source) {
  const attrs = {}
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  let match
  while ((match = re.exec(source)) !== null) {
    const name = match[1].toLowerCase()
    if (name === '' || name === '/') continue
    const raw = match[2] ?? match[3] ?? match[4] ?? ''
    attrs[name] = decodeEntities(raw)
  }
  return attrs
}

/**
 * Parse HTML into a light element tree.
 * Returns the synthetic root node; `root.children` holds the document.
 */
export function parseHtml(html) {
  const root = { type: 'element', tag: '#root', attrs: {}, children: [] }
  const stack = [root]
  let index = 0
  const length = html.length

  const pushText = (text) => {
    if (text === '') return
    stack[stack.length - 1].children.push({ type: 'text', text: decodeEntities(text) })
  }

  while (index < length) {
    const lt = html.indexOf('<', index)
    if (lt === -1) {
      pushText(html.slice(index))
      break
    }
    if (lt > index) pushText(html.slice(index, lt))

    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4)
      index = end === -1 ? length : end + 3
      continue
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const end = html.indexOf('>', lt + 2)
      index = end === -1 ? length : end + 1
      continue
    }

    const gt = html.indexOf('>', lt + 1)
    if (gt === -1) {
      pushText(html.slice(lt))
      break
    }
    const raw = html.slice(lt + 1, gt).trim()
    index = gt + 1

    if (raw === '') continue
    if (raw[0] === '/') {
      const tag = raw.slice(1).trim().toLowerCase()
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].tag === tag) {
          stack.length = i
          break
        }
      }
      continue
    }

    const selfClosing = raw.endsWith('/')
    const body = selfClosing ? raw.slice(0, -1) : raw
    const space = body.search(/\s/)
    const tag = (space === -1 ? body : body.slice(0, space)).toLowerCase()
    if (tag === '') continue
    const node = {
      type: 'element',
      tag,
      attrs: space === -1 ? {} : parseAttributes(body.slice(space + 1)),
      children: [],
    }
    stack[stack.length - 1].children.push(node)

    if (selfClosing || VOID_ELEMENTS.has(tag)) continue

    if (RAW_TEXT_ELEMENTS.has(tag)) {
      const close = html.toLowerCase().indexOf(`</${tag}`, index)
      const end = close === -1 ? length : close
      const inner = html.slice(index, end)
      if (inner !== '') node.children.push({ type: 'text', text: inner })
      const gt2 = close === -1 ? -1 : html.indexOf('>', close)
      index = gt2 === -1 ? length : gt2 + 1
      continue
    }

    stack.push(node)
  }

  return root
}

/** Plain text of a node, with block-level line breaks preserved. */
export function textOf(node) {
  const out = []
  const walk = (current, block) => {
    if (current.type === 'text') {
      out.push(current.text)
      return
    }
    if (current.type !== 'element') return
    if (SKIP_TEXT_ELEMENTS.has(current.tag)) return
    const isBlock = BLOCK_ELEMENTS.has(current.tag)
    if (isBlock) out.push('\n')
    for (const child of current.children) walk(child, isBlock)
    if (isBlock && current.tag !== 'br') out.push('\n')
  }
  walk(node, true)
  return normalizeBlockText(out.join(''))
}

/** Collapse the whitespace an HTML document sprinkles through CJK text. */
export function normalizeBlockText(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function elementChildren(node) {
  return node.children.filter((child) => child.type === 'element')
}

function parseSelector(selector) {
  const parts = []
  for (const raw of String(selector).trim().split(/\s+/)) {
    if (raw === '' || raw === '>') continue
    const match = /^([a-zA-Z][\w-]*|\*)?((?:[.#][\w-]+)*)$/.exec(raw)
    if (match === null) return null
    const classes = []
    let id = null
    for (const piece of match[2].match(/[.#][\w-]+/g) ?? []) {
      if (piece[0] === '#') id = piece.slice(1)
      else classes.push(piece.slice(1))
    }
    parts.push({ tag: match[1] && match[1] !== '*' ? match[1].toLowerCase() : null, id, classes })
  }
  return parts.length === 0 ? null : parts
}

function matchesPart(node, part) {
  if (node.type !== 'element' || node.tag === '#root') return false
  if (part.tag !== null && node.tag !== part.tag) return false
  if (part.id !== null && node.attrs.id !== part.id) return false
  for (const name of part.classes) {
    const value = node.attrs.class ?? ''
    if (!value.split(/\s+/).includes(name)) return false
  }
  return true
}

/** Match a descendant chain; returns the deepest matched node or null. */
function matchChain(node, parts, index) {
  if (!matchesPart(node, parts[index])) return false
  if (index === 0) return true
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (matchChain(parent, parts, index - 1)) return true
  }
  return false
}

function walkElements(root, visit) {
  const stack = [...root.children].reverse()
  while (stack.length > 0) {
    const node = stack.pop()
    if (node.type !== 'element') continue
    if (visit(node) === false) return
    for (let i = node.children.length - 1; i >= 0; i -= 1) stack.push(node.children[i])
  }
}

export function queryAll(root, selector, limit = 50) {
  const parts = parseSelector(selector)
  if (parts === null) return []
  const found = []
  walkElements(root, (node) => {
    if (matchChain(node, parts, parts.length - 1)) {
      found.push(node)
      if (found.length >= limit) return false
    }
    return true
  })
  return found
}

export function queryFirst(root, selector) {
  return queryAll(root, selector, 1)[0] ?? null
}

function countCjk(text) {
  const matches = text.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g)
  return matches === null ? 0 : matches.length
}

const CONTENT_SELECTORS = [
  '#content', '#chaptercontent', '#chapter-content', '#booktxt', '#htmlContent',
  '.content', '.chapter-content', '.read-content', '.entry-content', '.article-content',
  '.txtnav', 'article', '#chapter', '.chapter', '.read', 'main', '#main', '.container',
]

/** Parse and wire parent links so selector matching can walk ancestors. */
export function parseDocument(html) {
  const root = parseHtml(html)
  const attach = (node) => {
    for (const child of elementChildren(node)) {
      child.parent = node
      attach(child)
    }
  }
  attach(root)
  return root
}

/**
 * Pull the chapter body out of a whole page.
 *
 * When `selector` is supplied it wins. Otherwise each known container is
 * scored by the amount of CJK text it holds, and the densest one wins;
 * failing that, the text of <body> is used.
 */
export function extractMainText(html, selector) {
  const root = parseDocument(html)

  if (selector) {
    const node = queryFirst(root, selector)
    if (node) {
      const text = textOf(node)
      if (text.length > 0) return text
    }
  }

  // Priority order, not "biggest wins": a wrapper (.content) contains the
  // article (#content) plus the site's breadcrumb and reader toolbar, so
  // scoring by size picked the wrapper and every chapter opened with
  // "首页 / 目录 / 关灯 / 字体- / …". The first specific container that already
  // holds an article-sized body wins; only when none qualifies do we fall
  // back to the largest candidate.
  let best = null
  let bestScore = 0
  for (const candidate of CONTENT_SELECTORS) {
    const node = queryFirst(root, candidate)
    if (node === null) continue
    const text = textOf(node)
    const score = countCjk(text)
    if (score >= 200) return text
    if (score > bestScore) {
      best = text
      bestScore = score
    }
  }

  const body = queryFirst(root, 'body')
  const fallback = body ? textOf(body) : textOf(root)
  return fallback
}
