/**
 * dsh-moyu-novel — a bookshelf drawer for DeepSeek Harness.
 *
 * Host half: a local library on disk, the HTTP surface the Client half reads,
 * and the agent tools that fill the library (file / URL / text / dsh-novel
 * cache). The stealth behaviour itself lives in the Client half.
 */
import path from 'node:path'
import { Library, isValidId } from './lib/library.js'
import { dshHome, hasNovelCache, readNovelShelf } from './lib/sources.js'
import { downloadChapters, importFile, importNovelCache, importText, importUrl } from './lib/importers.js'
import { Prefetch } from './lib/prefetch.js'
import { normalizeBody } from './lib/text.js'

export const name = 'dsh-moyu-novel'
export const inject = ['tools']

const ROUTE_PREFIX = '/moyu-novel'
const MAX_DOWNLOAD_BATCH = 40

/** Tool results are JSON; the renderer prints it as the call's text body. */
function textOutput(schema) {
  return {
    schema,
    render(_args, value) {
      const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
      return [{ type: 'text', text }]
    },
  }
}

function objectSchema(properties, required = []) {
  return { type: 'object', properties, additionalProperties: false, required }
}

function warn(ctx, message) {
  try {
    ctx.logger?.warn?.(`[moyu-novel] ${message}`)
  } catch {
    /* logging is best effort */
  }
}

function json(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

const MAX_BODY_BYTES = 1_000_000

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let tooLarge = false
    req.on('data', (chunk) => {
      if (tooLarge) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        tooLarge = true
        const error = new Error('请求体过大')
        error.status = 413
        // Drain instead of destroy: destroying the socket would also swallow
        // the 413 response the caller needs to see.
        reject(error)
        req.resume()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (tooLarge) return
      const raw = Buffer.concat(chunks).toString('utf8')
      if (raw.trim() === '') return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

/**
 * The reader API lives on the same origin as the app. The web server has no
 * server-wide auth, so this route enforces its own: a page on another origin
 * must not be able to delete books or read a whole library over loopback.
 */
function sameOrigin(req) {
  const headers = req.headers ?? {}
  const site = headers['sec-fetch-site']
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') return false
  const origin = headers.origin
  if (typeof origin === 'string' && origin !== '') {
    try {
      return new URL(origin).host === headers.host
    } catch {
      return false
    }
  }
  return true
}

export function apply(ctx, config = {}) {
  const options = config && typeof config === 'object' ? config : {}
  const libraryDir = typeof options.libraryDir === 'string' && options.libraryDir.trim() !== ''
    ? options.libraryDir
    : path.join(dshHome(), 'moyu-novel')
  const library = new Library(libraryDir)

  // The tail of a long download runs on its own clock: the reader gets the
  // first chapters now, and the rest lands while they read.
  const prefetch = new Prefetch(library, { log: (message) => warn(ctx, message) })

  /* ---------------------------------------------------------------- routes */

  // The route lives on the Host web server, which may be provisioned after
  // this plugin activates (or replaced when the carrier restarts). A one-shot
  // `ctx.get('webServer')` at apply time silently skipped registration in that
  // case — the settings row and the drawer still worked, but every API call
  // answered 404. `ctx.inject` runs the registration when the service exists
  // and re-runs it if the service is ever replaced.
  const mountRoutes = (hostCtx) => {
    const webServer = hostCtx.get('webServer')
    if (!webServer) return
    hostCtx.effect(() => {
      try {
        return webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: async (req, res) => {
        if (!sameOrigin(req)) return json(res, 403, { error: '跨站请求已拒绝' })
        const url = new URL(req.url ?? '/', 'http://localhost')
        const route = url.pathname.slice(ROUTE_PREFIX.length) || '/'
        try {
          if (req.method === 'GET' && (route === '/api/library' || route === '/api/books')) {
            return json(res, 200, { books: await library.list() })
          }

          if (req.method === 'GET' && route === '/api/book') {
            const id = url.searchParams.get('id') ?? ''
            const meta = await library.readMeta(id)
            if (meta === null) return json(res, 404, { error: '书不存在' })
            return json(res, 200, {
              id: meta.id,
              title: meta.title,
              author: meta.author ?? '',
              chapters: meta.chapters,
              progress: meta.progress ?? { chapter: 0, ratio: 0 },
              cached: meta.cached ?? null,
            })
          }

          if (req.method === 'GET' && route === '/api/chapter') {
            const id = url.searchParams.get('id') ?? ''
            const index = Number(url.searchParams.get('index') ?? '0')
            const chapter = await library.readChapter(id, index)
            if (chapter === null) return json(res, 404, { error: '章节不存在' })
            return json(res, 200, chapter)
          }

          if (req.method === 'POST' && route === '/api/progress') {
            const body = await readBody(req)
            if (!isValidId(body.id)) return json(res, 400, { error: '缺少书 id' })
            const progress = await library.saveProgress(body.id, Number(body.chapter) || 0, Number(body.ratio) || 0)
            if (progress === null) return json(res, 404, { error: '书不存在' })
            return json(res, 200, { progress })
          }

          if (req.method === 'GET' && route === '/api/shelf') {
            return json(res, 200, { books: await readNovelShelf(), available: await hasNovelCache() })
          }

          if (req.method === 'POST' && route === '/api/shelf/import') {
            const body = await readBody(req)
            const result = await importNovelCache(library, {
              bookKey: String(body.bookKey ?? ''),
              sourceId: String(body.sourceId ?? ''),
              title: body.title ? String(body.title) : undefined,
            })
            return json(res, 200, {
              id: result.book.id,
              title: result.book.title,
              chapters: result.chapters,
              missing: result.missing,
              filled: result.filled ?? 0,
              merged: result.merged === true,
            })
          }

          if (req.method === 'POST' && route === '/api/remove') {
            const body = await readBody(req)
            if (!isValidId(body.id)) return json(res, 400, { error: '缺少书 id' })
            await library.remove(body.id)
            return json(res, 200, { ok: true })
          }

          return json(res, 404, { error: '未知接口' })
        } catch (error) {
          const status = Number(error?.status) || 500
          warn(hostCtx, `${route} 失败: ${error instanceof Error ? error.message : String(error)}`)
          return json(res, status, { error: error instanceof Error ? error.message : String(error) })
        }
      },
        })
      } catch (error) {
        warn(hostCtx, `本地阅读接口注册失败（可能已被占用）：${error instanceof Error ? error.message : String(error)}`)
        return () => {}
      }
    }, 'dsh-moyu-novel: local reader API')
  }

  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], mountRoutes)
  } else {
    // Cordis without dynamic inject: register when the service already exists.
    mountRoutes(ctx)
  }

  /* ----------------------------------------------------------------- tools */

  const libraries = {
    name: 'moyu_novel_library',
    description: '列出「书架」里的书（id、书名、作者、章节数、读到第几章）。先用它看看有哪些书可读，再决定导入或阅读。',
    parameters: objectSchema({}),
    output: textOutput(objectSchema({
      books: {
        type: 'array',
        items: objectSchema({
          id: { type: 'string' },
          title: { type: 'string' },
          author: { type: 'string' },
          chapters: { type: 'integer' },
          source: { type: 'string' },
          progress: { type: 'string', description: '形如 12/796（读到的章 / 总章）' },
        }),
      },
      libraryDir: { type: 'string' },
    })),
    async execute() {
      const books = await library.list()
      return {
        libraryDir,
        books: books.map((book) => ({
          id: book.id,
          title: book.title,
          author: book.author,
          chapters: book.chapters,
          source: book.source,
          progress: `${(book.progress?.chapter ?? 0) + 1}/${book.chapters}`,
        })),
      }
    },
  }

  const importTool = {
    name: 'moyu_novel_import',
    description: [
      '把一本书导入「书架」，导入后立刻能在 DSH 侧栏阅读。',
      'source=file 读本地文件（.txt / .epub / .html——单文件阅读页会按它内嵌的章节数据整体导入）；source=url 抓一个网页或 .epub；source=text 直接导入正文；',
      'source=cache 从 dsh-novel 插件的下载缓存搬运（需要 bookKey 与 sourceId，可从 moyu_novel_library 之外的 dshnovel_toc 结果或书架接口拿到）。',
      '找书下载的推荐姿势：用 web_search / web_fetch 找到一个能直链下载的 .txt/.epub，或用 dshnovel_* 工具把章节缓存下来，再调用本工具导入。',
    ].join(''),
    parameters: objectSchema({
      source: { type: 'string', enum: ['file', 'url', 'text', 'cache'], description: '导入方式' },
      path: { type: 'string', description: 'source=file 时的本地路径（绝对路径，支持 .txt/.epub/.html）' },
      url: { type: 'string', description: 'source=url 时的地址，支持 .epub 与整本书的网页' },
      text: { type: 'string', description: 'source=text 时的正文；含「第X章」标题时按章拆分，否则算一章' },
      title: { type: 'string', description: '书名；缺省用文件名 / 网页标题 / 首个章名' },
      author: { type: 'string', description: '作者' },
      selector: { type: 'string', description: 'source=url 时的正文容器 CSS 选择器，如 #content；缺省自动识别' },
      bookKey: { type: 'string', description: 'source=cache 时 dsh-novel 的书籍详情页地址' },
      sourceId: { type: 'string', description: 'source=cache 时 dsh-novel 的源 id' },
    }, ['source']),
    output: textOutput(objectSchema({
      id: { type: 'string' },
      title: { type: 'string' },
      chapters: { type: 'integer' },
      missing: { type: 'integer', description: 'source=cache 时尚未缓存的章节数' },
      note: { type: 'string' },
    })),
    async execute(args) {
      const input = args ?? {}
      const source = String(input.source ?? '')
      if (source === 'file') {
        const filePath = String(input.path ?? '')
        if (filePath === '') throw new Error('source=file 需要 path')
        const result = await importFile(library, filePath, { title: input.title, author: input.author })
        return {
          id: result.book.id,
          title: result.book.title,
          chapters: result.chapters,
          note: '已导入，可在侧栏书架上打开',
        }
      }
      if (source === 'url') {
        const url = String(input.url ?? '')
        if (url === '') throw new Error('source=url 需要 url')
        const result = await importUrl(library, url, { title: input.title, author: input.author, selector: input.selector })
        return { id: result.book.id, title: result.book.title, chapters: result.chapters, note: '已导入，可在侧栏书架上打开' }
      }
      if (source === 'text') {
        const text = String(input.text ?? '')
        if (text.trim() === '') throw new Error('source=text 需要 text')
        const result = await importText(library, { title: input.title, author: input.author, text })
        return { id: result.book.id, title: result.book.title, chapters: result.chapters, note: '已导入，可在侧栏书架上打开' }
      }
      if (source === 'cache') {
        const bookKey = String(input.bookKey ?? '')
        const sourceId = String(input.sourceId ?? '')
        if (bookKey === '' || sourceId === '') throw new Error('source=cache 需要 bookKey 与 sourceId')
        const result = await importNovelCache(library, { bookKey, sourceId, title: input.title, author: input.author })
        return {
          id: result.book.id,
          title: result.book.title,
          chapters: result.chapters,
          missing: result.missing,
          note: result.missing > 0
            ? `${result.missing} 章还没被 dsh-novel 缓存，阅读时会显示「尚未缓存」；先用 dshnovel_read 补齐即可`
            : '全部章节已从缓存导入',
        }
      }
      throw new Error(`未知 source：${source}`)
    },
  }

  const readTool = {
    name: 'moyu_novel_read',
    description: '读「书架」里某本书的某一章正文（0 起）。用于核对导入结果、摘录内容，或读给用户听；不要用它通读整本。',
    parameters: objectSchema({
      bookId: { type: 'string', description: '书 id，来自 moyu_novel_library' },
      chapter: { type: 'integer', description: '章序，0 起' },
      maxChars: { type: 'integer', description: '最多返回多少字，默认 4000' },
    }, ['bookId', 'chapter']),
    output: textOutput(objectSchema({
      title: { type: 'string' },
      index: { type: 'integer' },
      total: { type: 'integer' },
      text: { type: 'string' },
      truncated: { type: 'boolean' },
    })),
    async execute(args) {
      const input = args ?? {}
      const index = Math.max(0, Math.trunc(Number(input.chapter) || 0))
      const limit = Math.max(200, Math.trunc(Number(input.maxChars) || 4000))
      const chapter = await library.readChapter(String(input.bookId ?? ''), index)
      if (chapter === null) throw new Error('章节不存在；先用 moyu_novel_library 核对 bookId 与章节数')
      const meta = await library.readMeta(String(input.bookId))
      const text = normalizeBody(chapter.text)
      return {
        title: chapter.title,
        index,
        total: meta?.chapters.length ?? 0,
        text: text.length > limit ? `${text.slice(0, limit)}\n…（已截断）` : text,
        truncated: text.length > limit,
      }
    },
  }

  const downloadTool = {
    name: 'moyu_novel_download',
    description: [
      '按已知的章节地址抓正文并入库。适合「已经找到一本书的目录页、拿到各章 URL」之后落地成本地书。',
      '默认行为：先把前 20 章（initial）抓下来立刻能读，剩下的全部排进后台队列慢慢补——每 10 秒一章、每 50 章休息 90 秒，撞到站点频率限制还会自己退避。所以这里可以一次把整本的章节列表都传进来，不用分批。',
      '已入库的章节按章名跳过，所以重复调用是安全的续传：不会重复、不会乱序、已读进度不受影响。',
      '站点正文容器不确定时先传 contentSelector（如 #content、.read-content）；background=false 会退回「只抓这一批、剩下的还给你」，适合一次只想下几十章的情况。',
    ].join(''),
    parameters: objectSchema({
      title: { type: 'string', description: '书名（新建时必填）' },
      author: { type: 'string', description: '作者' },
      chapters: {
        type: 'array',
        description: '章节列表，按阅读顺序；可以给整本的（后台会接着补）',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '章名' },
            url: { type: 'string', description: '章节地址' },
          },
          required: ['url'],
        },
      },
      bookId: { type: 'string', description: '已有书的 id：给了就往这本后面追加；不给则新建' },
      contentSelector: { type: 'string', description: '正文容器的 CSS 选择器；缺省自动识别' },
      delayMs: { type: 'integer', description: '同步这一批每章间隔毫秒，默认 5000（站点配额约 12 章/分钟，不要调小）' },
      initial: { type: 'integer', description: '先同步抓多少章，剩下的进后台队列；默认 20，最多 40' },
      background: { type: 'boolean', description: '是否把剩下的章节排进后台队列，默认 true；传 false 则只抓这一批（最多 40 章）' },
    }, ['chapters']),
    output: textOutput(objectSchema({
      id: { type: 'string' },
      title: { type: 'string' },
      added: { type: 'integer' },
      total: { type: 'integer' },
      skipped: { type: 'integer', description: '按章名跳过、本来就在书里的章节数（续传时正常出现）' },
      remaining: {
        type: 'array',
        items: { type: 'string' },
        description: '因限速提前停下时，还没抓的章节地址；原样再调用一次即可续传',
      },
      failures: {
        type: 'array',
        items: objectSchema({ url: { type: 'string' }, reason: { type: 'string' } }),
      },
      queued: { type: 'integer', description: '排进后台队列的章节数' },
      background: { type: 'boolean', description: '是否有后台队列在跑' },
    })),
    async execute(args) {
      const input = args ?? {}
      const all = Array.isArray(input.chapters) ? input.chapters : []
      if (all.length === 0) throw new Error('chapters 不能为空')
      const background = input.background !== false
      const wanted = Number.isFinite(input.initial) ? Math.trunc(Number(input.initial)) : 20
      const initial = Math.min(Math.max(1, wanted), MAX_DOWNLOAD_BATCH)
      const head = background ? all.slice(0, initial) : all.slice(0, MAX_DOWNLOAD_BATCH)
      const tail = background ? all.slice(initial) : []
      const result = await downloadChapters(library, {
        bookId: typeof input.bookId === 'string' && input.bookId !== '' ? input.bookId : undefined,
        title: input.title,
        author: input.author,
        chapters: head,
        selector: input.contentSelector,
        delayMs: Number.isFinite(input.delayMs) ? Number(input.delayMs) : undefined,
      })
      let queued = 0
      if (tail.length > 0 && result.book !== null) {
        queued = await prefetch.enqueue({
          bookId: result.book.id,
          title: result.book.title,
          chapters: tail,
        })
      }
      return {
        id: result.book?.id ?? '',
        title: result.book?.title ?? '',
        added: result.added,
        total: result.book?.chapters.length ?? result.added,
        skipped: result.skipped,
        remaining: result.remaining,
        failures: result.failures,
        queued,
        background: queued > 0,
      }
    },
  }

  const prefetchTool = {
    name: 'moyu_novel_prefetch',
    description: [
      '长书的「后台静默补章」队列：下载工具默认把超出前 20 章的章节排进来，这里负责查看和控制。',
      'status 不传 bookId 会列出所有书；pause / resume / cancel 需要 bookId。',
      '队列每 10 秒一章、每 50 章休息 90 秒，连续失败 4 次会停下来等 resume；DSH 重启后会自己接着跑。',
    ].join(''),
    parameters: objectSchema({
      action: { type: 'string', enum: ['status', 'pause', 'resume', 'cancel'], description: '要做什么，默认 status' },
      bookId: { type: 'string', description: '只处理这本书；status 可以不给' },
    }, ['action']),
    output: textOutput(objectSchema({
      queues: {
        type: 'array',
        items: objectSchema({
          bookId: { type: 'string' },
          title: { type: 'string' },
          pending: { type: 'integer', description: '还没下的章节数' },
          done: { type: 'integer', description: '这个队列已经补了多少章' },
          failed: { type: 'integer', description: '重试后仍失败的章节数' },
          paused: { type: 'boolean' },
          lastError: { type: 'string' },
        }),
      },
      ok: { type: 'boolean' },
    })),
    async execute(args) {
      const input = args ?? {}
      const action = typeof input.action === 'string' && input.action !== '' ? input.action : 'status'
      const bookId = typeof input.bookId === 'string' ? input.bookId : ''
      if (action === 'status') return { queues: prefetch.status(bookId) }
      if (bookId === '') throw new Error('bookId 不能为空')
      if (action === 'pause') return { ok: await prefetch.pause(bookId) }
      if (action === 'resume') return { ok: await prefetch.resume(bookId) }
      if (action === 'cancel') return { ok: await prefetch.cancel(bookId) }
      throw new Error(`未知 action：${action}`)
    },
  }

  const removeTool = {
    name: 'moyu_novel_remove',
    description: '从「书架」删掉一本书（连同本地章节文件）。用户没明确要求时不要调用。',
    parameters: objectSchema({ bookId: { type: 'string' } }, ['bookId']),
    output: textOutput(objectSchema({ ok: { type: 'boolean' } })),
    async execute(args) {
      const id = String((args ?? {}).bookId ?? '')
      const meta = await library.readMeta(id)
      if (meta === null) throw new Error('书不存在')
      await library.remove(id)
      return { ok: true }
    },
  }

  for (const tool of [libraries, importTool, readTool, downloadTool, prefetchTool, removeTool]) {
    ctx.effect(() => {
      try {
        return ctx.tools.register(tool)
      } catch (error) {
        warn(ctx, `工具 ${tool.name} 注册失败：${error instanceof Error ? error.message : String(error)}`)
        return () => {}
      }
    }, `dsh-moyu-novel: ${tool.name}`)
  }

  // Warm the directory up so the first Client read does not race the mkdir.
  ctx.effect(() => {
    void library.ensure().catch(() => {})
    return () => {}
  }, 'dsh-moyu-novel: library dir')

  // Pick up any background queue the previous run left behind, and stop the
  // timers when this plugin is disposed.
  ctx.effect(() => {
    void prefetch.restore().catch((error) => {
      warn(ctx, `后台队列恢复失败：${error instanceof Error ? error.message : String(error)}`)
    })
    return () => prefetch.dispose()
  }, 'dsh-moyu-novel: prefetch queue')
}
