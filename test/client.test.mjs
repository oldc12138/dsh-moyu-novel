/** Smoke test for the client module: tab type, guide card, settings row, pane body. */
import fs from 'node:fs/promises'
import path from 'node:path'

/* ---- minimal browser-ish globals ---- */
const listeners = new Map()
const events = []
globalThis.window = {
  addEventListener(type, fn) { listeners.set(type, fn) },
  removeEventListener() {},
  location: { href: 'http://127.0.0.1:64605/' },
}
globalThis.document = {
  hidden: false,
  addEventListener() {},
  removeEventListener() {},
  getElementById: () => null,
  hasFocus: () => true,
  querySelector: () => null,
  querySelectorAll: () => [],
}
Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true })
const memory = new Map()
const storage = () => ({
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => { memory.set(key, String(value)) },
  removeItem: (key) => { memory.delete(key) },
})
globalThis.localStorage = storage()
globalThis.sessionStorage = storage()
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0)

/* ---- fake API data ---- */
const responses = {
  '/moyu-novel/api/library': {
    books: [{ id: 'b1', title: '运营中心 · 内部资料汇编', author: '', chapters: 3, progress: { chapter: 1, ratio: 0 }, cached: null }],
  },
  '/moyu-novel/api/book?id=b1': {
    id: 'b1', title: '运营中心 · 内部资料汇编', author: '',
    chapters: [{ title: '第1章' }, { title: '第2章' }, { title: '第3章' }], progress: { chapter: 1, ratio: 0 }, cached: null,
  },
  '/moyu-novel/api/chapter?id=b1&index=1': { index: 1, title: '第2章', text: '第二章的正文内容。' },
  '/moyu-novel/api/chapter?id=b1&index=2': { index: 2, title: '第3章', text: '第三章的正文。' },
  '/moyu-novel/api/shelf': { books: [] },
}
globalThis.fetch = async (url) => {
  const key = Object.keys(responses).find((k) => url.startsWith(k))
  if (!key) return { ok: false, status: 404, json: async () => ({ error: `nope ${url}` }) }
  return { ok: true, status: 200, json: async () => responses[key] }
}

/* ---- React stub ---- */
const React = {
  Fragment: '#fragment',
  createElement(type, props, ...children) {
    const kids = children.length === 0 ? undefined : children.length === 1 ? children[0] : children
    return { type, props: { ...(props || {}), children: kids } }
  },
  useState(init) { return [typeof init === 'function' ? init() : init, () => {}] },
  useEffect(fn) { try { const cleanup = fn(); if (typeof cleanup === 'function') events.push(cleanup) } catch (error) { console.log('effect threw:', error.message) } },
  useRef(init) { return { current: init } },
  useCallback(fn) { return fn },
  useMemo(fn) { return fn() },
  useSyncExternalStore(_sub, getSnapshot) { return getSnapshot() },
}

/* ---- load the module ---- */
let factory = null
globalThis.window.__ModuleLoader__ = { load({ factory: f }) { factory = f } }
const source = await fs.readFile(path.join(import.meta.dirname, '..', 'client.js'), 'utf8')
new Function('window', source)(globalThis.window)
const plugin = factory((id) => (id === 'react' ? React : undefined))

/* ---- stub context: services, slots, effects ---- */
const slots = new Map()
let tabDefinition = null
let openedKind = null
let rightbarClosed = 0
const ctx = {
  get: (name) => (name === 'locale' ? { register: () => () => {}, bind: () => (k) => k } : undefined),
  effect(fn) { const d = fn(); events.push(typeof d === 'function' ? d : () => {}); return () => {} },
  inject(deps, callback) {
    if (deps.includes('sidebarRightTabs')) {
      callback({
        get: (name) => (name === 'sidebarRightTabs'
          ? { register(definition) { tabDefinition = definition; return () => {} } }
          : undefined),
        effect: (fn) => { fn() },
      })
    }
    if (deps.includes('sidebarRight')) {
      callback({ sidebarRight: { openTab(kind) { openedKind = kind } } })
    }
  },
  layout: { closeRightbar() { rightbarClosed += 1 } },
  slots: {
    inject(_key, cb) { const d = cb(); return typeof d === 'function' ? d : () => {} },
    register(entry, component) {
      slots.set(`${entry.name}#${entry.id ?? entry.key ?? ''}`, { entry, component })
      return () => {}
    },
  },
}
plugin.apply(ctx)

const pane = slots.get('sidebar.right.pane.tab#dsh-moyu-novel')
const settings = slots.get('settings.general.item#moyu-novel')
console.log('tab type registered:', tabDefinition?.id === 'dsh-moyu-novel', '| kind:', tabDefinition?.kind,
  '| guide entries:', tabDefinition?.guide?.length, '| card title:', tabDefinition?.guide?.[0]?.title())
console.log('pane body registered:', Boolean(pane), '| settings row:', Boolean(settings))

/* ---- tree helpers ---- */
function flatten(node, out = []) {
  if (node == null || node === false) return out
  if (Array.isArray(node)) { for (const child of node) flatten(child, out); return out }
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (typeof node !== 'object') return out
  if (typeof node.type === 'function') return flatten(node.type(node.props || {}), out)
  if (typeof node.type === 'string') {
    out.push(node.type)
    if (node.props?.className) out.push('.' + node.props.className)
  }
  if (node.props) flatten(node.props.children, out)
  return out
}
const collect = (element) => flatten(element).join(' ')
const allButtons = (node, out = []) => {
  if (node == null) return out
  if (Array.isArray(node)) { for (const child of node) allButtons(child, out); return out }
  if (typeof node !== 'object') return out
  if (typeof node.type === 'function') return allButtons(node.type(node.props || {}), out)
  if (node.type === 'button' && node.props?.onClick) out.push(node)
  if (node.props) allButtons(node.props.children, out)
  return out
}
const buttonByText = (tree, text) => allButtons(tree).find((b) => JSON.stringify(b.props.children).includes(text))
const hasClass = (node, cls) => {
  if (node == null) return false
  if (Array.isArray(node)) return node.some((child) => hasClass(child, cls))
  if (typeof node !== 'object') return false
  if (typeof node.type === 'function') return hasClass(node.type(node.props || {}), cls)
  if (typeof node.props?.className === 'string' && node.props.className.split(/\s+/).includes(cls)) return true
  return node.props ? hasClass(node.props.children, cls) : false
}

/* ---- the pane renders the shelf, then a book, then prefs and contents ---- */
pane.component({})              // mount: the pane starts loading here
await new Promise((resolve) => setTimeout(resolve, 120))
const shelf = collect(pane.component({}))
console.log('pane class:', hasClass(pane.component({}), 'dsh-moyu-pane'))
console.log('loading?', shelf.includes('读取中'), '| empty?', shelf.includes('书架是空的'), '| book?', shelf.includes('运营中心'), '| error?', shelf.includes('失败') || shelf.includes('404'))

const row = (function find(node) {
  if (node == null || typeof node !== 'object') return null
  if (Array.isArray(node)) { for (const c of node) { const r = find(c); if (r) return r } return null }
  if (typeof node.type === 'function') return find(node.type(node.props || {}))
  if (node.props?.role === 'button' && node.props.onClick && node.props.tabIndex === 0) return node
  return node.props ? find(node.props.children) : null
})(pane.component({}))
row.props.onClick()
await new Promise((resolve) => setTimeout(resolve, 60))
const reader = collect(pane.component({}))
console.log('reader opened:', reader.includes('第2章'), '| text:', reader.includes('第二章的正文内容。'),
  '| chrome:', hasClass(pane.component({}), 'dsh-moyu-chrome'), '| progress:', hasClass(pane.component({}), 'dsh-moyu-progress'))

/* centre tap hides the chrome, like 阅读 */
const findScroll = (node) => {
  if (node == null || typeof node !== 'object') return null
  if (Array.isArray(node)) { for (const c of node) { const r = findScroll(c); if (r) return r } return null }
  if (typeof node.type === 'function') return findScroll(node.type(node.props || {}))
  if (typeof node.props?.className === 'string' && node.props.className.includes('dsh-moyu-scroll')) return node
  return node.props ? findScroll(node.props.children) : null
}
const clickCentre = () => {
  const node = findScroll(pane.component({}))
  node.props.onClick({ target: {}, clientX: 200, currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 400 }) } })
}
const hasTopChrome = (tree) => {
  return (function walk(node) {
    if (node == null || typeof node !== 'object') return false
    if (Array.isArray(node)) return node.some(walk)
    if (typeof node.type === 'function') return walk(node.type(node.props || {}))
    if (typeof node.props?.className === 'string' && node.props.className.includes('dsh-moyu-chrome top')) return true
    return node.props ? walk(node.props.children) : false
  })(tree)
}
console.log('top bar shows the book:', collect(pane.component({})).includes('运营中心'))
console.log('chapter title in the content:', hasClass(pane.component({}), 'dsh-moyu-chapter-title'))
console.log('bottom bar always there:', hasClass(pane.component({}), 'dsh-moyu-chrome'))

/* chapter-end button */
const endButton = (function walk(node) {
  if (node == null || typeof node !== 'object') return null
  if (Array.isArray(node)) { for (const c of node) { const r = walk(c); if (r) return r } return null }
  if (typeof node.type === 'function') return walk(node.type(node.props || {}))
  if (typeof node.props?.className === 'string' && node.props.className.includes('dsh-moyu-next')) return node
  return node.props ? walk(node.props.children) : null
})(pane.component({}))
console.log('chapter-end next button:', Boolean(endButton))
endButton.props.onClick()
await new Promise((resolve) => setTimeout(resolve, 80))
console.log('end button opened next chapter:', collect(pane.component({})).includes('第3章'))

/* reading settings */
const prefsToggle = buttonByText(pane.component({}), 'Aa')
prefsToggle.props.onClick()
const prefsText = collect(pane.component({}))
console.log('prefs panel:', prefsText.includes('阅读设置'), '| typography rows:', prefsText.includes('段距') && prefsText.includes('首行缩进'),
  '| night paper:', prefsText.includes('夜间'))
const nightChip = allButtons(pane.component({})).find((b) => JSON.stringify(b.props.children).includes('夜间'))
nightChip.props.onClick()
console.log('night paper applied:', JSON.parse(memory.get('moyu-novel.prefs') || '{}').paper === 'night')

/* contents overlay */
const tocButton = buttonByText(pane.component({}), '目录')
tocButton.props.onClick()
const tocTree = pane.component({})
console.log('contents overlay:', hasClass(tocTree, 'dsh-moyu-toc'), '| lists chapters:', collect(tocTree).includes('第2章'))

/* ---- settings row opens the tab ---- */
const launch = buttonByText(settings.component({}), '打开')
launch.props.onClick({ currentTarget: { closest: () => null } })
await new Promise((resolve) => setTimeout(resolve, 200))
console.log('settings row opens tab kind:', openedKind === 'moyu-novel')

/* ---- blur collapses the column ---- */
listeners.get('blur')({ target: globalThis.window })
console.log('blur collapsed the column:', rightbarClosed >= 1)
console.log('OK')
