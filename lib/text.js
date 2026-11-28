/**
 * Chapter splitting and text cleanup.
 *
 * Everything the reader shows goes through `normalizeBody`, so the same
 * cleaning applies to imported TXT, EPUB XHTML, cached chapter files and
 * pages fetched by the agent.
 */

/** Prefix of a chapter heading; the remainder is validated separately. */
const HEADING = /^(第\s*[0-9零〇一二三四五六七八九十百千万两兩]{1,9}\s*[章回节節卷集部篇]|序章|序言|楔子|前言|引子|尾声|後記|后记|番外|Chapter\s*\d{1,4})(.*)$/

/** A remainder that starts like this is prose, not a chapter title. */
const PROSE_START = /^[的了个是在和与就都也又我你他她它们，。；！？、…—·）)】」』”"']/
const PROSE_END = /[，。；！？、：:]$/

/** Whole lines that are site chrome rather than prose. */
const CHROME_LINES = new Set([
  '首页', '目录', '书签', '报错', '关灯', '开灯', '字体-', '字体+', '字体－', '字体＋',
  '上一章', '下一章', '上一页', '下一页', '加入书签', '返回目录', '章节目录', '全文阅读',
  '背景色', '护眼', '夜间', '日间', '设置', '目录夹', '章节报错',
])

const NOISE = [
  /请\s*点\s*击\s*下\s*一\s*页/,
  /本章未完/,
  /本章尚未结束/,
  /手机版阅读网址/,
  /最新网址[:：]/,
  /本章由.*?提供/,
  /加入书签|加入書籤/,
  /投推荐票|投推薦票/,
]

/** Collapse the rubble that HTML-to-text and bad CMS exports leave behind. */
export function normalizeBody(input) {
  const text = String(input ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u3000/g, '  ')
    .replace(/\u00a0/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/[ \u00a0]+$/gm, '')
  const kept = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') {
      if (kept.length > 0 && kept[kept.length - 1] !== '') kept.push('')
      continue
    }
    if (CHROME_LINES.has(trimmed)) continue
    if (NOISE.some((re) => re.test(trimmed))) continue
    kept.push(trimmed)
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function looksLikeHeading(line) {
  const trimmed = line.trim()
  if (trimmed === '' || trimmed.length > 40) return false
  if (PROSE_END.test(trimmed)) return false
  const match = HEADING.exec(trimmed)
  if (match === null) return false
  const rest = match[2].trim()
  if (rest === '') return true
  if (PROSE_START.test(rest)) return false
  // "第五章内容简介" style lines are page copy, not chapters.
  if (rest.length > 24) return false
  // Without a separator a long tail is almost always a sentence.
  if (!/^[\s:：、.．·\-—(（]/.test(match[2]) && rest.length > 12) return false
  return true
}

/**
 * Split a whole book into chapters.
 *
 * A book whose text has no recognisable chapter headings becomes one
 * chapter, which the reader still paginates by scroll.
 */
export function splitChapters(rawText) {
  const text = String(rawText ?? '').replace(/\r\n?/g, '\n').replace(/\u3000/g, '  ')
  const lines = text.split('\n')
  const chapters = []
  let title = null
  let buffer = []

  const flush = () => {
    const body = normalizeBody(buffer.join('\n'))
    buffer = []
    if (body === '') return
    chapters.push({ title: title ?? '正文', text: body })
  }

  for (const line of lines) {
    if (looksLikeHeading(line)) {
      flush()
      title = line.trim()
      continue
    }
    buffer.push(line)
  }
  flush()

  if (chapters.length === 0) {
    const body = normalizeBody(text)
    return body === '' ? [] : [{ title: '正文', text: body }]
  }
  // A short lead-in before the first heading is site furniture, not a chapter.
  if (chapters.length > 1 && chapters[0].title === '正文' && chapters[0].text.length < 300) {
    chapters.shift()
  }
  return chapters
}

/** Byte-wise safe short excerpt used in tool output. */
export function excerpt(text, limit = 160) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
  return clean.length <= limit ? clean : `${clean.slice(0, limit)}…`
}
