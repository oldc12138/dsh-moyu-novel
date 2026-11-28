/** Scratch checks for the plugin's pure library code. Not part of the bundle. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { splitChapters, normalizeBody } from '../lib/text.js'
import { extractMainText, parseDocument, queryAll, textOf } from '../lib/html.js'
import { Library } from '../lib/library.js'
import { importText } from '../lib/importers.js'

const results = []
function test(name, fn) {
  try {
    fn()
    results.push({ name, ok: true })
  } catch (error) {
    results.push({ name, ok: false, error: error.message })
  }
}

test('splitChapters finds headings and drops noise', () => {
  const raw = [
    '这是我的小说的前言部分，字数不多。',
    '',
    '第一章 起点',
    '第一节的内容。',
    '请点击下一页继续阅读',
    '',
    '第二章 中段',
    '第二节的内容。',
    '第三章 结尾',
    '第三节的内容。',
  ].join('\n')
  const chapters = splitChapters(raw)
  assert.equal(chapters.length, 3, JSON.stringify(chapters.map((c) => c.title)))
  assert.equal(chapters[0].title, '第一章 起点')
  assert.ok(chapters[0].text.includes('第一节的内容。'))
  assert.ok(!chapters[0].text.includes('请点击下一页'))
  assert.equal(chapters[2].title, '第三章 结尾')
})

test('splitChapters falls back to a single chapter', () => {
  const chapters = splitChapters('只有一段正文，没有章节标题。\n第二行。')
  assert.equal(chapters.length, 1)
  assert.equal(chapters[0].title, '正文')
  assert.ok(chapters[0].text.includes('第二行'))
})

test('normalizeBody collapses blank runs', () => {
  assert.equal(normalizeBody('a\n\n\n\nb'), 'a\n\nb')
})

test('normalizeBody drops a title pasted into the middle of sentences', () => {
  // The shape uukan serves: the watermark sits between the real words and the
  // sentence mark, twenty-odd times in one chapter.
  const sentence = '少年缓缓抬起头来，漆黑的眸子木然扫过，嘴角的自嘲变得更苦涩了。'
  const polluted = sentence.repeat(60).replace(/。/g, '水印书名。')
  assert.ok(polluted.includes('水印书名'), 'fixture is wrong')
  const cleaned = normalizeBody(polluted)
  assert.ok(!cleaned.includes('水印书名'), 'watermark survived')
  assert.equal((cleaned.match(/。/g) ?? []).length, 60, 'punctuation changed')
  assert.ok(cleaned.includes('嘴角的自嘲变得更苦涩了。'), 'prose damaged')
})

test('normalizeBody leaves ordinary repeated prose alone', () => {
  const lines = [
    '他抬头看了看天色，云层压得很低，风从山口灌进来，吹得衣角猎猎作响。',
    '街角那家药铺的招牌晃了晃，伙计探出头来，又缩了回去。',
    '少年没有回头，只是把手里的木牌攥得更紧了些。',
    '院子里有人在扫落叶，扫帚擦过青石，声音一阵一阵的。',
    '他笑了一下，然后走开了。',
    '远处的山脊压着一层灰白，像是要落雪了。',
    '老人把茶碗搁在桌上，眼皮都没有抬一下。',
    '铜钱在指缝间翻了两圈，落回掌心。',
    '窗纸被风顶得鼓起来，又慢慢平下去。',
    '巷子尽头的灯笼亮了一盏，昏黄昏黄的。',
    '她把袖口理了理，转身进了内堂。',
    '马蹄声从街上过去，很快就听不见了。',
    '少年捏着那枚令牌，指尖有些发凉。',
    '屋檐下积着一线雨水，滴在石阶上。',
    '掌柜拨了拨算盘珠子，抬头报了个价。',
    '风停了，院子里只剩下虫鸣。',
    '他靠着门框站了一会儿，终于还是走了进去。',
    '炉子里的火苗跳了一下，映得人脸发红。',
    '檐角的风铃响了两声，便不再作声。',
    '所有人都安静下来，等着那句回答。',
  ]
  const text = Array.from({ length: 120 }, (_, i) => lines[i % lines.length]).join('')
  assert.ok(text.length > 2000, 'fixture needs length')
  assert.equal(normalizeBody(text), text.trim())
})

test('extractMainText ignores chrome around the article', () => {
  const html = `<html><head><title>t</title><style>.x{}</style></head><body>
    <nav><a href="/">首页</a><a href="/a">目录</a></nav>
    <div id="content"><p>${'正文内容。'.repeat(60)}</p><p>第二段。</p></div>
    <footer>版权声明</footer></body></html>`
  const text = extractMainText(html)
  assert.ok(text.includes('正文内容。'), 'missing body text')
  assert.ok(!text.includes('版权声明'), 'footer leaked into body')
  assert.ok(text.length > 200)
})

test('extractMainText prefers the inner article over a chrome wrapper', () => {
  const html = `<html><body>
    <div class="content">
      <ol class="breadcrumb"><li>首页</li><li>游戏</li><li>书名</li></ol>
      <div>第1章 标题</div>
      <div>关灯 字体- 字体+ 目录 书签 报错</div>
      <div id="content" class="readcontent"><p>${'正文内容。'.repeat(60)}</p></div>
    </div></body></html>`
  const text = extractMainText(html)
  assert.ok(text.includes('正文内容。'), 'body missing')
  assert.ok(!text.includes('首页'), 'wrapper chrome leaked in')
  assert.ok(!text.includes('关灯'), 'toolbar leaked in')
})

test('extractMainText honours an explicit selector', () => {
  const html = '<html><body><div class="a">AAA</div><div class="b">BBB</div></body></html>'
  assert.equal(extractMainText(html, '.b'), 'BBB')
})

test('selector engine handles descendants and classes', () => {
  const root = parseDocument('<div class="bookbox"><h2 class="bookname"><a href="/b/1">书名</a></h2></div>')
  const links = queryAll(root, '.bookbox h2.bookname a')
  assert.equal(links.length, 1)
  assert.equal(textOf(links[0]), '书名')
  assert.equal(links[0].attrs.href, '/b/1')
})

test('Library round-trips a book', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moyu-'))
  const library = new Library(path.join(dir, 'lib'))
  const book = await library.create({ title: '测试书', author: '作者', chapters: [{ title: '第一章', text: '正文一' }, { title: '第二章', text: '正文二' }] })
  const list = await library.list()
  assert.equal(list.length, 1)
  assert.equal(list[0].chapters, 2)
  const chapter = await library.readChapter(book.id, 1)
  assert.equal(chapter.text, '正文二')
  await library.saveProgress(book.id, 1, 0.5)
  const meta = await library.readMeta(book.id)
  assert.equal(meta.progress.chapter, 1)
  assert.equal(meta.progress.ratio, 0.5)
  await library.remove(book.id)
  assert.equal((await library.list()).length, 0)
  await fs.rm(dir, { recursive: true, force: true })
})

test('importText stores a split book', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moyu-'))
  const library = new Library(path.join(dir, 'lib'))
  const result = await importText(library, { title: '导入', text: '第一章 甲\naaa\n第二章 乙\nbbb' })
  assert.equal(result.chapters, 2)
  const chapter = await library.readChapter(result.book.id, 1)
  assert.ok(chapter.text.includes('bbb'))
  await fs.rm(dir, { recursive: true, force: true })
})

/* A tiny stored-only ZIP so readZip/readEpub can be exercised for real. */
function buildZip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.from(content, 'utf8')
    const nameBytes = Buffer.from(name, 'utf8')
    const local = Buffer.alloc(30 + nameBytes.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(0, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    nameBytes.copy(local, 30)
    locals.push(local, data)

    const central = Buffer.alloc(46 + nameBytes.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    nameBytes.copy(central, 46)
    centrals.push(central)
    offset += local.length + data.length
  }
  const centralBuffer = Buffer.concat(centrals)
  const localBuffer = Buffer.concat(locals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(Object.keys(entries).length, 8)
  eocd.writeUInt16LE(Object.keys(entries).length, 10)
  eocd.writeUInt32LE(centralBuffer.length, 12)
  eocd.writeUInt32LE(localBuffer.length, 16)
  return Buffer.concat([localBuffer, centralBuffer, eocd])
}

const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>测试 EPUB</dc:title><dc:creator>某人</dc:creator>
  </metadata>
  <manifest>
    <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`

const container = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`

const chapterOne = `<html><head><title>不该用这个</title></head><body><h2>第一章 起</h2><p>${'第一章的正文。'.repeat(20)}</p></body></html>`
const chapterTwo = `<html><body><h2>第二章 承</h2><p>${'第二章的正文。'.repeat(20)}</p></body></html>`

const { readEpub } = await import('../lib/epub.js')
const zip = buildZip({
  'mimetype': 'application/epub+zip',
  'META-INF/container.xml': container,
  'OEBPS/content.opf': opf,
  'OEBPS/ch1.xhtml': chapterOne,
  'OEBPS/ch2.xhtml': chapterTwo,
})
test('readEpub follows the OPF spine', () => {
  const book = readEpub(zip)
  assert.equal(book.title, '测试 EPUB')
  assert.equal(book.author, '某人')
  assert.equal(book.chapters.length, 2, JSON.stringify(book.chapters.map((c) => c.title)))
  assert.equal(book.chapters[0].title, '第一章 起')
  assert.ok(book.chapters[1].text.includes('第二章的正文。'))
})

const failed = results.filter((row) => !row.ok)
for (const row of results) console.log(`${row.ok ? 'PASS' : 'FAIL'}  ${row.name}${row.ok ? '' : `\n      ${row.error}`}`)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length > 0) process.exitCode = 1
