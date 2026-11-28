/**
 * Client half of dsh-moyu-novel.
 *
 * Registers a real right-sidebar tab type (stage one: `ctx.sidebarRightTabs`,
 * stage two: the `sidebar.right.pane.tab` body) plus one guide card, so the
 * shelf sits beside Workspace files / Terminal / Browser on the guide page
 * instead of behind a custom overlay. The column collapses the moment the
 * window loses focus — the tab stays in the layout, so reopening the column
 * brings the same chapter back.
 */
window.__ModuleLoader__.load({
  id: 'dsh-moyu-novel',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState, useSyncExternalStore } = React

    const NS = 'moyu-novel'
    const API = '/moyu-novel/api'
    const TAB_ID = 'dsh-moyu-novel'
    const TAB_KIND = 'moyu-novel'
    const FONT_MIN = 13
    const FONT_MAX = 28

    /* ------------------------------------------------------------- locale */

    const DICT = {
      zh: {
        'tab.title': '书架',
        'settings.label': '书架',
        'settings.desc': '在右侧栏安静地看小说；窗口失去焦点时自动收起。',
        'settings.open': '打开',
        'settings.opening': '正在打开…',
        'shelf.title': '书架',
        'shelf.loading': '读取中…',
        'shelf.chapters': '{n} 章',
        'shelf.doImport': '导入',
        'shelf.deleteConfirmShort': '确认删除',
        'shelf.missingImported': '有 {n} 章还没被 dsh-novel 缓存，读到时会是空白。',
        'banner.dismiss': '关闭提示',
        'shelf.empty': '书架是空的。让 AI 帮你找书，或从 dsh-novel 导入。',
        'shelf.emptyNoNovel': '书架是空的。',
        'shelf.emptyHint': '对 AI 说：「帮我找《书名》，下到书架」。',
        'shelf.import': '从 dsh-novel 导入',
        'shelf.importEmpty': 'dsh-novel 书架上没有可导入的书。',
        'shelf.noNovel': '这台机器上没有 dsh-novel（或它还没有书）。可以让 AI 直接把本地文件、网页正文或整本书的 HTML 导进来：试试「把这个文件导入书架」并附上路径。',
        'shelf.importing': '正在导入…',
        'shelf.imported': '已导入',
        'shelf.howToAdd': '怎么加书',
        'shelf.refreshed': '已补上 {n} 章。',
        'shelf.missing': '缺 {n} 章',
        'shelf.progress': '{done}/{total} 章',
        'shelf.delete': '删除这本书',
        'shelf.deleteConfirm': '删掉《{title}》？本地章节会被一并删除。',
        'shelf.back': '返回书架',
        'reader.back': '返回书架',
        'reader.chapter': '第 {n} 章',
        'reader.of': '/ {total}',
        'reader.prev': '上一章',
        'reader.next': '下一章',
        'reader.empty': '这一章还没有正文。',
        'reader.missing': '这一章尚未缓存。用 dshnovel_read 补齐后再导入一次即可。',
        'reader.loading': '读取中…',
        'reader.jump': '跳到',
        'prefs.open': '阅读设置',
        'prefs.title': '阅读设置',
        'prefs.font': '字号',
        'prefs.line': '行距',
        'prefs.paper': '纸张',
        'prefs.paper.theme': '跟随主题',
        'prefs.paper.cream': '米黄',
        'prefs.paper.white': '纯白',
        'prefs.paper.green': '浅绿',
        'prefs.paper.pink': '浅粉',
        'prefs.paper.night': '夜间',
        'prefs.fontFamily': '字体',
        'prefs.font.system': '系统',
        'prefs.font.serif': '宋体',
        'prefs.font.kai': '楷体',
        'prefs.para': '段距',
        'prefs.indent': '首行缩进',
        'prefs.tapTurn': '点击翻页',
        'prefs.on': '开',
        'prefs.off': '关',
        'reader.hint': '点左右翻页，点中间显示工具栏',
        'reader.nextChapter': '下一章',
        'reader.endOfBook': '— 全书完 —',
        'toc.open': '目录',
        'toc.search': '搜索章节标题',
        'toc.empty': '没有匹配的章节',
        'toc.count': '共 {n} 章',
        'error.noRoute': '接口没挂上（HTTP 404）。刷新一次页面即可；还不行就重启 DSH。',
      },
      en: {
        'tab.title': 'Bookshelf',
        'settings.label': 'Bookshelf',
        'settings.desc': 'Read quietly in the right column; it collapses when the window loses focus.',
        'settings.open': 'Open',
        'settings.opening': 'Opening…',
        'shelf.title': 'Bookshelf',
        'shelf.loading': 'Loading…',
        'shelf.chapters': '{n} chapters',
        'shelf.doImport': 'Import',
        'shelf.deleteConfirmShort': 'Delete',
        'shelf.missingImported': '{n} chapters were never cached by dsh-novel and will read as blank.',
        'banner.dismiss': 'Dismiss',
        'shelf.empty': 'No books yet. Ask the agent to find one, or import from dsh-novel.',
        'shelf.emptyNoNovel': 'No books yet.',
        'shelf.emptyHint': 'Try: “Find <title> and put it on my bookshelf”.',
        'shelf.import': 'Import from dsh-novel',
        'shelf.importEmpty': 'The dsh-novel shelf is empty.',
        'shelf.noNovel': 'dsh-novel is not installed here (or holds no books). Ask the agent to import a local file, a page of text, or a whole-book HTML: “put this file on my bookshelf” with the path.',
        'shelf.importing': 'Importing…',
        'shelf.imported': 'Imported',
        'shelf.howToAdd': 'How to add books',
        'shelf.refreshed': 'Filled in {n} more chapters.',
        'shelf.missing': '{n} missing',
        'shelf.progress': '{done}/{total} chapters',
        'shelf.delete': 'Remove this book',
        'shelf.deleteConfirm': 'Remove “{title}” and its local chapters?',
        'shelf.back': 'Back to shelf',
        'reader.back': 'Back to shelf',
        'reader.chapter': 'Chapter {n}',
        'reader.of': '/ {total}',
        'reader.prev': 'Previous',
        'reader.next': 'Next',
        'reader.empty': 'This chapter has no text yet.',
        'reader.missing': 'This chapter was never cached. Re-run dshnovel_read and import again.',
        'reader.loading': 'Loading…',
        'reader.jump': 'Go to',
        'prefs.open': 'Reading settings',
        'prefs.title': 'Reading settings',
        'prefs.font': 'Font size',
        'prefs.line': 'Line height',
        'prefs.paper': 'Paper',
        'prefs.paper.theme': 'Follow theme',
        'prefs.paper.cream': 'Cream',
        'prefs.paper.white': 'White',
        'prefs.paper.green': 'Pale green',
        'prefs.paper.pink': 'Pale pink',
        'prefs.paper.night': 'Night',
        'prefs.fontFamily': 'Typeface',
        'prefs.font.system': 'System',
        'prefs.font.serif': 'Serif',
        'prefs.font.kai': 'Kai',
        'prefs.para': 'Paragraph gap',
        'prefs.indent': 'Indent first line',
        'prefs.tapTurn': 'Tap to turn pages',
        'prefs.on': 'On',
        'prefs.off': 'Off',
        'reader.hint': 'Tap the sides to turn pages, the middle for controls',
        'reader.nextChapter': 'Next chapter',
        'reader.endOfBook': '— The end —',
        'toc.open': 'Contents',
        'toc.search': 'Search chapter titles',
        'toc.empty': 'No matching chapter',
        'toc.count': '{n} chapters',
        'error.noRoute': 'The reader API is not mounted (HTTP 404). Refresh the page; if it persists, restart DSH.',
      },
    }

    let boundTranslate = null

    function tr(key, params) {
      let text = key
      if (boundTranslate) {
        try {
          const value = boundTranslate(key)
          if (typeof value === 'string' && value !== '') text = value
        } catch {
          /* fall through to the built-in dictionary */
        }
      }
      if (text === key) {
        const lang = String(navigator.language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en'
        text = DICT[lang]?.[key] ?? DICT.en[key] ?? key
      }
      if (params) for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value))
      return text
    }

    /* ------------------------------------------------------- reader prefs */

    const PREFS_KEY = 'moyu-novel.prefs'

    /** Paper presets: a reading surface is content, so it keeps its own ink. */
    const PAPERS = {
      theme: null,
      cream: { bg: '#f7f3e8', ink: '#2f2a22' },
      white: { bg: '#ffffff', ink: '#242424' },
      green: { bg: '#e8f0e8', ink: '#22301f' },
      pink: { bg: '#f0e8e8', ink: '#332324' },
      night: { bg: '#1b1b1d', ink: '#b9b9b9' },
    }

    /** Font stacks in the spirit of 阅读's font picker, minus bundled webfonts. */
    const FONT_STACKS = {
      system: '-apple-system,"Segoe UI","Microsoft YaHei",system-ui,sans-serif',
      serif: '"Songti SC","Noto Serif CJK SC","Source Han Serif SC",SimSun,serif',
      kai: '"Kaiti SC",KaiTi,"STKaiti",serif',
    }

    const FONT_CHOICES = [15, 17, 19, 21, 23, 25]
    const LINE_CHOICES = [1.6, 1.8, 2.0, 2.2]
    const PARA_CHOICES = [0, 0.4, 0.8, 1.2]

    function loadPrefs() {
      const prefs = { fontSize: 18, lineHeight: 1.8, paper: 'theme', para: 0.8, indent: true, font: 'system', tapTurn: false }
      try {
        const raw = localStorage.getItem(PREFS_KEY)
        if (raw) {
          const saved = JSON.parse(raw)
          if (Number.isFinite(saved?.fontSize) && saved.fontSize >= FONT_MIN && saved.fontSize <= FONT_MAX) {
            prefs.fontSize = Math.round(saved.fontSize)
          }
          if (LINE_CHOICES.includes(Number(saved?.lineHeight))) prefs.lineHeight = Number(saved.lineHeight)
          if (PARA_CHOICES.includes(Number(saved?.para))) prefs.para = Number(saved.para)
          if (typeof saved?.indent === 'boolean') prefs.indent = saved.indent
          if (typeof saved?.tapTurn === 'boolean') prefs.tapTurn = saved.tapTurn
          if (typeof saved?.font === 'string' && FONT_STACKS[saved.font]) prefs.font = saved.font
          if (saved?.paper && Object.prototype.hasOwnProperty.call(PAPERS, saved.paper)) prefs.paper = saved.paper
          return prefs
        }
        const legacy = Number(localStorage.getItem('moyu-novel.fontSize'))
        if (Number.isFinite(legacy) && legacy >= FONT_MIN && legacy <= FONT_MAX) prefs.fontSize = legacy
      } catch {
        /* storage may be unavailable */
      }
      return prefs
    }

    function savePrefs(patch) {
      const next = { ...state, ...patch }
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify({
          fontSize: next.fontSize,
          lineHeight: next.lineHeight,
          paper: next.paper,
          para: next.para,
          indent: next.indent,
          font: next.font,
          tapTurn: next.tapTurn,
        }))
      } catch {
        /* ignore */
      }
      commit(patch)
    }

    /* -------------------------------------------------------------- store */

    const initial = {
      view: 'shelf',
      books: null,
      shelf: null,
      shelfAvailable: true,
      error: '',
      notice: '',
      book: null,
      chapters: [],
      index: 0,
      text: '',
      prefsOpen: false,
      tocOpen: false,
      tocQuery: '',
      readRatio: 0,
      loading: false,
      ...loadPrefs(),
    }

    let state = { ...initial }
    const listeners = new Set()

    function commit(patch) {
      state = { ...state, ...patch }
      for (const listener of listeners) listener()
    }

    function subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }

    function useStore() {
      return useSyncExternalStore(subscribe, () => state, () => state)
    }

    async function api(path, init) {
      const response = await fetch(`${API}${path}`, {
        cache: 'no-store',
        ...init,
        headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        // A 404 without a JSON error body means the Host route is not mounted
        // (typically right after the app restarts), not that a book is missing.
        if (data.error) throw new Error(data.error)
        if (response.status === 404) throw new Error(tr('error.noRoute'))
        throw new Error(`HTTP ${response.status}`)
      }
      return data
    }

    /* ----------------------------------------------------------- behaviour */

    async function loadBooks() {
      try {
        const data = await api('/library')
        commit({ books: data.books ?? [], error: '' })
      } catch (error) {
        commit({ books: [], error: error.message })
      }
    }

    async function loadShelf() {
      try {
        const data = await api('/shelf')
        commit({ shelf: data.books ?? [], shelfAvailable: data.available !== false, error: '' })
      } catch (error) {
        commit({ shelf: [], error: error.message })
      }
    }

    function lastBookId() {
      try {
        return localStorage.getItem('moyu-novel.lastBook') || ''
      } catch {
        return ''
      }
    }

    /** The spot as mirrored locally, when it is ahead of the server copy. */
    function furthestProgress(id, serverProgress) {
      const server = {
        chapter: Math.max(0, Math.trunc(Number(serverProgress?.chapter) || 0)),
        ratio: Math.min(1, Math.max(0, Number(serverProgress?.ratio) || 0)),
      }
      let local = null
      try {
        const raw = localStorage.getItem(`moyu-novel.pos.${id}`)
        if (raw) {
          const value = JSON.parse(raw)
          if (value && Number.isFinite(value.chapter)) {
            local = {
              chapter: Math.max(0, Math.trunc(value.chapter)),
              ratio: Math.min(1, Math.max(0, Number(value.ratio) || 0)),
            }
          }
        }
      } catch {
        /* a broken mirror just means "use the server copy" */
      }
      if (!local) return server
      if (local.chapter > server.chapter) return local
      if (local.chapter === server.chapter && local.ratio > server.ratio) return local
      return server
    }

    let progressTimer = null
    let pendingProgress = null

    function scheduleProgress(bookId, chapter, ratio) {
      if (!bookId) return
      try {
        localStorage.setItem(`moyu-novel.pos.${bookId}`, JSON.stringify({ chapter, ratio, at: Date.now() }))
      } catch { /* storage may be unavailable */ }
      pendingProgress = { bookId, chapter, ratio }
      if (progressTimer !== null) return
      progressTimer = setTimeout(() => {
        progressTimer = null
        const payload = pendingProgress
        pendingProgress = null
        if (!payload || !payload.bookId) return
        void api('/progress', {
          method: 'POST',
          body: JSON.stringify({ id: payload.bookId, chapter: payload.chapter, ratio: payload.ratio }),
        }).catch(() => {})
      }, 700)
    }

    async function openBook(id, { fallbackToShelf = false } = {}) {
      commit({ error: '', view: 'reader', loading: true, text: '' })
      try {
        const meta = await api(`/book?id=${encodeURIComponent(id)}`)
        const saved = furthestProgress(id, meta.progress)
        const start = Math.min(saved.chapter, Math.max(0, meta.chapters.length - 1))
        commit({ book: meta, chapters: meta.chapters, index: start })
        await loadChapter(start, saved.ratio)
        try { localStorage.setItem('moyu-novel.lastBook', id) } catch { /* ignore */ }
      } catch (error) {
        // Resuming into a book that was deleted (the shelf was cleared, or it
        // went away in another window) is not something to shout about: drop the
        // stale pointer and land on the shelf.
        if (fallbackToShelf) {
          commit({ loading: false, error: '', view: 'shelf', book: null })
          try { localStorage.removeItem('moyu-novel.lastBook') } catch { /* ignore */ }
          await loadBooks()
        } else {
          commit({ loading: false, error: error.message, view: 'shelf', book: null })
        }
      }
    }

    /** Newest chapter request; an older answer must not touch the reader. */
    let chapterSeq = 0

    async function loadChapter(index, ratio = 0) {
      const book = state.book
      if (!book) return
      const bounded = Math.max(0, Math.min(book.chapters.length - 1, index))
      const seq = (chapterSeq += 1)
      commit({ loading: true, index: bounded, error: '', text: '' })
      try {
        const chapter = await api(`/chapter?id=${encodeURIComponent(book.id)}&index=${bounded}`)
        if (seq !== chapterSeq) return
        // `readRatio` tracks the chapter the reader is showing; without this the
        // progress bar would keep the previous chapter's offset after a jump.
        commit({ text: chapter.text ?? '', loading: false, error: '', readRatio: ratio })
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const scroller = document.getElementById('moyu-novel-scroll')
          if (!scroller) return
          const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
          scroller.scrollTop = ratio > 0 ? ratio * max : 0
        }))
      } catch (error) {
        if (seq !== chapterSeq) return
        commit({ loading: false, error: error.message, text: '' })
      }
    }

    /** Continuity: the shelf opens on the last book unless asked otherwise. */
    async function resume() {
      const last = lastBookId()
      if (last !== '' && state.book === null) {
        await openBook(last, { fallbackToShelf: true })
        return
      }
      if (state.books === null) await loadBooks()
    }

    /**
     * Close the settings dialog that hosts our row, so opening the shelf does
     * not leave a settings page behind the column. Scoped to that dialog only.
     */
    function dismissSettings(fromElement) {
      try {
        const dialog = fromElement?.closest?.('[role="dialog"], [role="alertdialog"]')
        if (!dialog) return false
        for (const button of dialog.querySelectorAll('button[aria-label]')) {
          const label = (button.getAttribute('aria-label') || '').trim()
          if (/^(关闭设置|关闭面板|关闭|收起|close settings|close|dismiss)$/i.test(label)) {
            button.click()
            return true
          }
        }
      } catch {
        /* fall through: the tab still opens */
      }
      return false
    }

    /* ------------------------------------------------------------- visuals */

    const CSS = `
      .dsh-moyu-pane{display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;
        background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13.5px}
      .dsh-moyu-pane-head{display:flex;align-items:center;gap:8px;padding:8px 12px;flex:none;
        border-bottom:1px solid var(--dsw-alias-border-l1)}
      .dsh-moyu-pane-title{font-weight:600;font-size:14px;flex:1;min-width:0;overflow:hidden;
        text-overflow:ellipsis;white-space:nowrap}
      .dsh-moyu-sub{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:400}
      .dsh-moyu-btn{appearance:none;border:1px solid transparent;background:transparent;
        color:var(--dsw-alias-label-secondary);border-radius:var(--dsw-radius-sm,6px);padding:3px 7px;
        font-size:12.5px;cursor:pointer;line-height:1.5;display:inline-flex;align-items:center;gap:4px}
      .dsh-moyu-btn:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2));
        color:var(--dsw-alias-label-primary)}
      .dsh-moyu-btn:disabled{opacity:.55;cursor:default}
      .dsh-moyu-btn[data-primary=true]{border-color:var(--dsw-alias-border-l2);
        color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
      .dsh-moyu-btn-on{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
      .dsh-moyu-btn-danger{color:var(--dsw-alias-state-error-primary);
        border-color:var(--dsw-alias-state-error-primary);background:transparent}
      .dsh-moyu-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain}
      .dsh-moyu-row{display:flex;align-items:center;gap:10px;padding:10px 12px;
        border-bottom:1px solid var(--dsw-alias-border-l1);cursor:pointer}
      .dsh-moyu-row:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}
      .dsh-moyu-row-main{flex:1;min-width:0}
      .dsh-moyu-row-title{font-size:13.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;
        white-space:nowrap}
      .dsh-moyu-row-meta{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:2px;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dsh-moyu-empty{padding:26px 18px;color:var(--dsw-alias-label-secondary);font-size:12.5px;
        line-height:1.7;text-align:center}
      .dsh-moyu-reader{position:relative;flex:1;min-height:0;display:flex;flex-direction:column}
      .dsh-moyu-scroll{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;
        scroll-behavior:smooth}
      .dsh-moyu-paper{max-width:46em;margin:0 auto;padding:30px 30px 40px}
      .dsh-moyu-text{word-break:break-word;text-align:justify;letter-spacing:.2px;
        line-height:var(--moyu-line,1.8);font-size:var(--moyu-font,18px);
        font-family:var(--moyu-family,inherit)}
      .dsh-moyu-text p{margin:0 0 var(--moyu-para,.8em);text-indent:var(--moyu-indent,2em)}
      .dsh-moyu-chapter-title{font-weight:600;font-size:1.05em;margin:0 0 1.2em;opacity:.8}
      .dsh-moyu-next{display:block;margin:26px auto 8px;padding:8px 26px;cursor:pointer;
        font-size:13.5px;color:inherit;background:transparent;
        border:1px solid currentColor;border-radius:999px;opacity:.7}
      .dsh-moyu-next:hover{opacity:1;background:var(--dsw-alias-interactive-bg-hover,transparent)}
      .dsh-moyu-end{margin:26px auto 8px;text-align:center;font-size:12.5px;opacity:.5}
      .dsh-moyu-chrome{flex:none;display:flex;align-items:center;gap:6px;padding:6px 10px;
        background:var(--dsw-alias-bg-layer-1)}
      .dsh-moyu-chrome.top{border-bottom:1px solid var(--dsw-alias-border-l1)}
      .dsh-moyu-chrome.bottom{border-top:1px solid var(--dsw-alias-border-l1)}
      .dsh-moyu-chrome .grow{flex:1}
      .dsh-moyu-progress{flex:none;height:2px;background:var(--dsw-alias-border-l1)}
      .dsh-moyu-progress-fill{height:100%;background:var(--dsw-alias-brand-primary);
        transition:width .2s ease}
      .dsh-moyu-jump{width:46px;background:transparent;color:inherit;font:inherit;
        border:1px solid transparent;border-radius:var(--dsw-radius-sm,6px);
        padding:2px;font-size:12.5px;text-align:right}
      .dsh-moyu-jump:hover,.dsh-moyu-jump:focus{border-color:var(--dsw-alias-border-l1);outline:none}
      .dsh-moyu-jump::-webkit-outer-spin-button,.dsh-moyu-jump::-webkit-inner-spin-button{
        -webkit-appearance:none;margin:0}
      .dsh-moyu-jump{-moz-appearance:textfield;appearance:textfield}
      .dsh-moyu-error,.dsh-moyu-notice{display:flex;align-items:flex-start;gap:8px;padding:8px 12px;
        font-size:12.5px;line-height:1.6;border-bottom:1px solid var(--dsw-alias-border-l1)}
      .dsh-moyu-error{color:var(--dsw-alias-state-error-primary)}
      .dsh-moyu-notice{color:var(--dsw-alias-label-secondary)}
      .dsh-moyu-banner-text{flex:1;min-width:0}
      .dsh-moyu-hint{padding:12px 14px;color:var(--dsw-alias-label-secondary);font-size:12px;
        line-height:1.6;border-top:1px solid var(--dsw-alias-border-l1)}
      .dsh-moyu-prefs{position:absolute;left:0;right:0;bottom:44px;z-index:6;
        padding:10px 12px 12px;background:var(--dsw-alias-bg-overlay);
        border-top:1px solid var(--dsw-alias-border-l1);
        box-shadow:0 -8px 24px rgba(0,0,0,.16);max-height:60%;overflow-y:auto}
      .dsh-moyu-prefs-head{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);
        margin-bottom:6px}
      .dsh-moyu-prefs-row{display:flex;align-items:center;flex-wrap:wrap;gap:4px;padding:3px 0}
      .dsh-moyu-prefs-label{width:38px;flex:none;font-size:12px;color:var(--dsw-alias-label-secondary)}
      .dsh-moyu-chip{appearance:none;cursor:pointer;font-size:12px;line-height:1.5;
        padding:2px 8px;border-radius:var(--dsw-radius-sm,6px);
        border:1px solid transparent;background:transparent;
        color:var(--dsw-alias-label-secondary);display:inline-flex;align-items:center;gap:5px}
      .dsh-moyu-chip:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2));
        color:var(--dsw-alias-label-primary)}
      .dsh-moyu-chip.on{border-color:var(--dsw-alias-border-l2);
        background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
      .dsh-moyu-swatch-dot{display:inline-block;width:12px;height:12px;border-radius:50%;
        border:1px solid var(--dsw-alias-border-l2)}
      .dsh-moyu-toc{position:absolute;inset:0;z-index:7;display:flex;flex-direction:column;
        background:var(--dsw-alias-bg-base)}
      .dsh-moyu-toc-head{display:flex;align-items:center;gap:8px;padding:8px 12px;
        border-bottom:1px solid var(--dsw-alias-border-l1)}
      .dsh-moyu-toc-search{flex:1;min-width:0;padding:4px 8px;font-size:12.5px;
        background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);
        border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm,6px)}
      .dsh-moyu-toc-list{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain}
      .dsh-moyu-toc-item{display:flex;align-items:center;gap:10px;width:100%;padding:7px 12px;
        text-align:left;cursor:pointer;font-size:13px;
        background:transparent;color:var(--dsw-alias-label-primary);
        border:none;border-bottom:1px solid var(--dsw-alias-border-l1)}
      .dsh-moyu-toc-item:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}
      .dsh-moyu-toc-item.on{background:var(--dsw-alias-bg-layer-2);
        border-left:2px solid var(--dsw-alias-brand-primary);padding-left:10px}
      .dsh-moyu-toc-index{flex:none;width:34px;font-size:12px;font-variant-numeric:tabular-nums;
        color:var(--dsw-alias-label-secondary)}
      .dsh-moyu-toc-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dsh-moyu-set{display:flex;align-items:center;gap:12px;padding:12px 0}
      .dsh-moyu-set-main{flex:1;min-width:0}
      .dsh-moyu-set-label{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:500;
        color:var(--dsw-alias-label-primary);line-height:1.5}
      .dsh-moyu-set-desc{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.55;
        margin-top:2px}
      .dsh-moyu-set-open{appearance:none;cursor:pointer;font-size:12.5px;line-height:1.4;
        padding:5px 12px;border-radius:var(--dsw-radius-sm,6px);white-space:nowrap;
        color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);
        border:1px solid var(--dsw-alias-border-l2)}
      .dsh-moyu-set-open:hover{background:var(--dsw-alias-bg-overlay)}
      .dsh-moyu-set-open:disabled{opacity:.6;cursor:default}
    `

    /* ---------------------------------------------------------- components */

    function BookIcon({ size = 16 }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true,
      },
        h('path', { d: 'M3 2.8h6.2A1.8 1.8 0 0 1 11 4.6v8.6H4.8A1.8 1.8 0 0 1 3 11.4z' }),
        h('path', { d: 'M11 4.6l2 .9v8.7l-2-1' }),
      )
    }

    /** Glyph for the guide capsule; the guide draws its cube when none is given. */
    function GuideIcon(props) {
      return h(BookIcon, { size: props?.size ?? 16 })
    }

    function SettingsRow() {
      const [opening, setOpening] = useState(false)

      const launch = (event) => {
        setOpening(true)
        const closed = dismissSettings(event?.currentTarget)
        setTimeout(() => {
          openShelfTab()
          setOpening(false)
        }, closed ? 160 : 0)
      }

      return h('div', { className: 'dsh-moyu-set' },
        h('style', null, CSS),
        h('div', { className: 'dsh-moyu-set-main' },
          h('div', { className: 'dsh-moyu-set-label' }, h(BookIcon, { size: 15 }), tr('settings.label')),
          h('div', { className: 'dsh-moyu-set-desc' }, tr('settings.desc')),
        ),
        h('button', {
          type: 'button',
          className: 'dsh-moyu-set-open',
          disabled: opening,
          onClick: launch,
        }, opening ? tr('settings.opening') : tr('settings.open')),
      )
    }

    /** One shelf row: opens the book, with a two-step delete that never leaves the pane. */
    function BookRow({ book }) {
      const [confirming, setConfirming] = useState(false)
      const [deleting, setDeleting] = useState(false)

      useEffect(() => {
        if (!confirming) return undefined
        const timer = setTimeout(() => setConfirming(false), 3000)
        return () => clearTimeout(timer)
      }, [confirming])

      const open = () => { if (!deleting) void openBook(book.id) }

      const remove = async () => {
        if (!confirming) {
          setConfirming(true)
          return
        }
        setDeleting(true)
        try {
          await api('/remove', { method: 'POST', body: JSON.stringify({ id: book.id }) })
          await loadBooks()
        } catch (error) {
          commit({ error: error.message })
        } finally {
          setDeleting(false)
          setConfirming(false)
        }
      }

      return h('div', {
        className: 'dsh-moyu-row',
        role: 'button',
        tabIndex: 0,
        'aria-label': book.title,
        onClick: open,
        onKeyDown: (event) => {
          if (event.target !== event.currentTarget) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            open()
          }
        },
      },
        h('div', { className: 'dsh-moyu-row-main' },
          h('div', { className: 'dsh-moyu-row-title' }, book.title),
          h('div', { className: 'dsh-moyu-row-meta' },
            (book.author ? `${book.author} · ` : '')
              + tr('shelf.progress', { done: (book.progress?.chapter ?? 0) + 1, total: book.chapters }),
            book.cached && book.cached.missing > 0 ? ` · ${tr('shelf.missing', { n: book.cached.missing })}` : '',
          ),
        ),
        h('button', {
          type: 'button',
          className: confirming ? 'dsh-moyu-btn dsh-moyu-btn-danger' : 'dsh-moyu-btn',
          title: confirming ? tr('shelf.deleteConfirm', { title: book.title }) : tr('shelf.delete'),
          'aria-label': confirming ? tr('shelf.deleteConfirmShort') : tr('shelf.delete'),
          disabled: deleting,
          onClick: (event) => { event.stopPropagation(); void remove() },
          onKeyDown: (event) => event.stopPropagation(),
        }, confirming ? tr('shelf.deleteConfirmShort') : '×'),
      )
    }

    function ShelfView() {
      const s = useStore()
      if (s.books === null) return h('div', { className: 'dsh-moyu-empty' }, tr('shelf.loading'))
      if (s.books.length === 0) {
        // dsh-novel is an optional neighbour: only offer its import path once we
        // know its cache is actually there, so a standalone install does not send
        // people down a dead end.
        const withNovel = s.shelfAvailable !== false
        return h('div', { className: 'dsh-moyu-empty' },
          h('div', null, withNovel ? tr('shelf.empty') : tr('shelf.emptyNoNovel')),
          h('div', { style: { marginTop: 8 } }, tr('shelf.emptyHint')),
          withNovel
            ? null
            : h('div', { style: { marginTop: 12, textAlign: 'left' } }, tr('shelf.noNovel')),
          withNovel
            ? h('div', { style: { marginTop: 14 } },
                h('button', {
                  type: 'button',
                  className: 'dsh-moyu-btn',
                  'data-primary': 'true',
                  onClick: () => { commit({ view: 'import' }); void loadShelf() },
                }, tr('shelf.import')),
              )
            : null,
        )
      }
      return h('div', { className: 'dsh-moyu-body' },
        s.books.map((book) => h(BookRow, { key: book.id, book })),
        h('div', { className: 'dsh-moyu-hint' },
          h('button', {
            type: 'button',
            className: 'dsh-moyu-btn',
            onClick: () => { commit({ view: 'import' }); void loadShelf() },
          }, tr('shelf.import')),
        ),
      )
    }

    function ImportView() {
      const s = useStore()
      const [busyKey, setBusyKey] = useState('')
      const rows = s.shelf
      if (s.shelfAvailable === false && (rows === null || rows.length === 0)) {
        return h('div', { className: 'dsh-moyu-empty' },
          h('div', null, tr('shelf.noNovel')),
          h('div', { style: { marginTop: 10 } }, tr('shelf.emptyHint')),
          h('div', { style: { marginTop: 14 } },
            h('button', { type: 'button', className: 'dsh-moyu-btn', onClick: () => commit({ view: 'shelf' }) }, '← ' + tr('shelf.back')),
          ),
        )
      }
      return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 } },
        rows === null
          ? h('div', { className: 'dsh-moyu-empty' }, tr('shelf.loading'))
          : rows.length === 0
            ? h('div', { className: 'dsh-moyu-empty' }, tr('shelf.importEmpty'))
            : h('div', { className: 'dsh-moyu-body' }, rows.map((row) => h('div', {
                key: row.bookKey,
                className: 'dsh-moyu-row',
                style: { cursor: 'default' },
              },
                h('div', { className: 'dsh-moyu-row-main' },
                  h('div', { className: 'dsh-moyu-row-title' }, row.title || row.bookKey),
                  h('div', { className: 'dsh-moyu-row-meta' }, tr('shelf.chapters', { n: row.totalChapters || 0 })),
                ),
                h('button', {
                  type: 'button',
                  className: 'dsh-moyu-btn',
                  'data-primary': 'true',
                  disabled: busyKey !== '',
                  onClick: async () => {
                    setBusyKey(row.bookKey)
                    try {
                      const result = await api('/shelf/import', {
                        method: 'POST',
                        body: JSON.stringify({ bookKey: row.bookKey, sourceId: row.sourceId, title: row.title }),
                      })
                      await loadBooks()
                      commit({ view: 'shelf', error: '' })
                      if (result.filled > 0) commit({ notice: tr('shelf.refreshed', { n: result.filled }) })
                      else if (result.missing > 0) commit({ notice: tr('shelf.missingImported', { n: result.missing }) })
                    } catch (error) {
                      commit({ error: error.message })
                    } finally {
                      setBusyKey('')
                    }
                  },
                }, busyKey === row.bookKey ? tr('shelf.importing') : tr('shelf.doImport')),
              ))),
        h('div', { className: 'dsh-moyu-hint' },
          h('button', { type: 'button', className: 'dsh-moyu-btn', onClick: () => commit({ view: 'shelf' }) }, '← ' + tr('shelf.back')),
          h('div', { style: { marginTop: 8 } }, tr('shelf.emptyHint')),
        ),
      )
    }

    function ReaderView() {
      const s = useStore()
      const scroller = useRef(null)

      // Persist the spot and drive the hairline progress bar.
      useEffect(() => {
        const node = scroller.current
        if (!node) return undefined
        let lastCommit = 0
        const onScroll = () => {
          const max = Math.max(1, node.scrollHeight - node.clientHeight)
          const ratio = Math.min(1, node.scrollTop / max)
          scheduleProgress(s.book?.id, s.index, ratio)
          const now = Date.now()
          if (now - lastCommit > 120) {
            lastCommit = now
            commit({ readRatio: ratio })
          }
        }
        node.addEventListener('scroll', onScroll, { passive: true })
        return () => node.removeEventListener('scroll', onScroll)
      }, [s.index, s.book?.id])

      // Reopening the column remounts the pane at scrollTop 0. Put the reader
      // back where the last scroll left it, once the body and the pane have a
      // height (the column can still be opening on the first frames).
      const restored = useRef(false)
      useEffect(() => {
        if (restored.current || !s.text) return
        const node = scroller.current
        if (!node) return
        restored.current = true
        const ratio = Math.min(1, Math.max(0, Number(s.readRatio) || 0))
        if (ratio <= 0) return
        let frames = 0
        const place = () => {
          frames += 1
          if (node.clientHeight === 0) {
            if (frames < 90) requestAnimationFrame(place)
            return
          }
          node.scrollTop = ratio * Math.max(0, node.scrollHeight - node.clientHeight)
        }
        requestAnimationFrame(place)
      }, [s.text])

      const total = s.chapters.length
      const chapterTitle = s.chapters[s.index]?.title || tr('reader.chapter', { n: s.index + 1 })
      const progress = total === 0 ? 0 : Math.min(100, ((s.index + s.readRatio) / total) * 100)

      const paper = PAPERS[s.paper] ?? null
      const surfaceStyle = {
        '--moyu-font': `${s.fontSize}px`,
        '--moyu-line': String(s.lineHeight),
        '--moyu-para': `${s.para}em`,
        '--moyu-indent': s.indent ? '2em' : '0',
        '--moyu-family': FONT_STACKS[s.font] || FONT_STACKS.system,
      }
      if (paper) {
        surfaceStyle.background = paper.bg
        surfaceStyle.color = paper.ink
      }

      /** Reading's gesture: a screen at a time, next/previous chapter at the edges. */
      const turn = (direction) => {
        const node = scroller.current
        if (!node) return
        const step = Math.max(120, node.clientHeight * 0.9)
        const max = node.scrollHeight - node.clientHeight
        if (direction > 0) {
          if (node.scrollTop >= max - 8) {
            if (s.index < total - 1) void loadChapter(s.index + 1, 0)
            return
          }
          node.scrollBy({ top: step })
          return
        }
        if (node.scrollTop <= 8) {
          if (s.index > 0) void loadChapter(s.index - 1, 1)
          return
        }
        node.scrollBy({ top: -step })
      }

      const onSurface = (event) => {
        if (!s.tapTurn) return
        const target = event.target
        if (target?.closest?.('a,button,input,select,textarea')) return
        const selection = window.getSelection?.()
        if (selection && String(selection).length > 0) return
        const rect = event.currentTarget.getBoundingClientRect()
        if (rect.width === 0) return
        const ratio = (event.clientX - rect.left) / rect.width
        if (ratio < 0.3) turn(-1)
        else if (ratio > 0.7) turn(1)
      }

      const paragraphs = String(s.text || '').split(/\n+/).map((text) => text.trim()).filter(Boolean)

      const chip = (active, label, onClick, extra) => h('button', {
        type: 'button',
        className: active ? 'dsh-moyu-chip on' : 'dsh-moyu-chip',
        'aria-pressed': active ? 'true' : 'false',
        onClick,
        ...extra,
      }, label)

      const query = s.tocQuery.trim().toLowerCase()
      const matches = []
      for (let i = 0; i < s.chapters.length; i += 1) {
        const title = String(s.chapters[i]?.title ?? '')
        if (query === '' || title.toLowerCase().includes(query)) matches.push({ index: i, title })
      }

      const jumpTo = (raw) => {
        const next = Math.trunc(Number(raw)) - 1
        if (Number.isFinite(next) && next >= 0 && next < total && next !== s.index) void loadChapter(next, 0)
      }

      return h('div', { className: 'dsh-moyu-reader' },
        h('div', {
          className: 'dsh-moyu-chrome top',
          onClick: (event) => event.stopPropagation(),
        },
          h('button', {
            type: 'button', className: 'dsh-moyu-btn', title: tr('reader.back'), 'aria-label': tr('reader.back'),
            onClick: () => { commit({ view: 'shelf', book: null, tocOpen: false, prefsOpen: false }); void loadBooks() },
          }, '←'),
          h('div', { className: 'dsh-moyu-pane-title', title: s.book?.title ?? '' }, s.book?.title ?? ''),
          h('span', { className: 'dsh-moyu-sub' }, `${s.index + 1} / ${total}`),
        ),
        h('div', {
          id: 'moyu-novel-scroll',
          className: 'dsh-moyu-scroll',
          ref: scroller,
          style: surfaceStyle,
          onClick: onSurface,
        },
          h('div', { className: 'dsh-moyu-paper' },
            h('div', { className: 'dsh-moyu-chapter-title' }, chapterTitle),
            s.loading
              ? h('div', { className: 'dsh-moyu-text' }, tr('reader.loading'))
              : paragraphs.length > 0
                ? h('div', { className: 'dsh-moyu-text' }, paragraphs.map((text, index) => h('p', { key: `p-${index}` }, text)))
                : h('div', { className: 'dsh-moyu-text' },
                    s.book?.cached && s.book.cached.missing > 0 ? tr('reader.missing') : tr('reader.empty')),
            s.loading ? null : (s.index < total - 1
              ? h('button', {
                  type: 'button',
                  className: 'dsh-moyu-next',
                  onClick: () => { void loadChapter(s.index + 1, 0) },
                }, tr('reader.nextChapter') + ' ›')
              : h('div', { className: 'dsh-moyu-end' }, tr('reader.endOfBook'))),
          ),
        ),
        h('div', {
          className: 'dsh-moyu-chrome bottom',
          onClick: (event) => event.stopPropagation(),
        },
          h('button', {
            type: 'button', className: 'dsh-moyu-btn', disabled: s.index <= 0 || s.loading,
            onClick: () => void loadChapter(s.index - 1, 1),
          }, '‹ ' + tr('reader.prev')),
          h('button', {
            type: 'button',
            className: s.tocOpen ? 'dsh-moyu-btn dsh-moyu-btn-on' : 'dsh-moyu-btn',
            title: tr('toc.open'),
            'aria-label': tr('toc.open'),
            onClick: () => commit({ tocOpen: true, prefsOpen: false }),
          }, tr('toc.open')),
          h('span', { className: 'grow' }),
          h('input', {
            className: 'dsh-moyu-jump',
            type: 'number',
            min: 1,
            max: Math.max(1, total),
            key: `jump-${s.index}-${total}`,
            defaultValue: s.index + 1,
            'aria-label': tr('reader.jump'),
            onKeyDown: (event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                jumpTo(event.currentTarget.value)
                event.currentTarget.blur()
              }
            },
            onBlur: (event) => jumpTo(event.currentTarget.value),
          }),
          h('span', { className: 'dsh-moyu-sub' }, `/ ${total}`),
          h('button', {
            type: 'button',
            className: s.prefsOpen ? 'dsh-moyu-btn dsh-moyu-btn-on' : 'dsh-moyu-btn',
            title: tr('prefs.open'),
            'aria-label': tr('prefs.open'),
            'aria-expanded': s.prefsOpen ? 'true' : 'false',
            onClick: () => commit({ prefsOpen: !s.prefsOpen, tocOpen: false }),
          }, 'Aa'),
          h('button', {
            type: 'button', className: 'dsh-moyu-btn', disabled: s.index >= total - 1 || s.loading,
            onClick: () => void loadChapter(s.index + 1, 0),
          }, tr('reader.next') + ' ›'),
        ),
        s.prefsOpen ? h('div', { className: 'dsh-moyu-prefs', onClick: (event) => event.stopPropagation() },
          h('div', { className: 'dsh-moyu-prefs-head' }, tr('prefs.title')),
          h('div', { className: 'dsh-moyu-prefs-row' },
            h('span', { className: 'dsh-moyu-prefs-label' }, tr('prefs.font')),
            FONT_CHOICES.map((size) => chip(s.fontSize === size, String(size), () => savePrefs({ fontSize: size }))),
          ),
          h('div', { className: 'dsh-moyu-prefs-row' },
            h('span', { className: 'dsh-moyu-prefs-label' }, tr('prefs.line')),
            LINE_CHOICES.map((value) => chip(s.lineHeight === value, String(value), () => savePrefs({ lineHeight: value }))),
          ),
          h('div', { className: 'dsh-moyu-prefs-row' },
            h('span', { className: 'dsh-moyu-prefs-label' }, tr('prefs.para')),
            PARA_CHOICES.map((value) => chip(s.para === value, value === 0 ? '0' : String(value), () => savePrefs({ para: value }))),
          ),
          h('div', { className: 'dsh-moyu-prefs-row' },
            h('span', { className: 'dsh-moyu-prefs-label' }, tr('prefs.fontFamily')),
            Object.keys(FONT_STACKS).map((key) => chip(s.font === key, tr(`prefs.font.${key}`), () => savePrefs({ font: key }))),
          ),
          h('div', { className: 'dsh-moyu-prefs-row' },
            h('span', { className: 'dsh-moyu-prefs-label' }, tr('prefs.indent')),
            chip(s.indent === true, tr('prefs.on'), () => savePrefs({ indent: true })),
            chip(s.indent === false, tr('prefs.off'), () => savePrefs({ indent: false })),
          ),
          h('div', { className: 'dsh-moyu-prefs-row' },
            h('span', { className: 'dsh-moyu-prefs-label' }, tr('prefs.tapTurn')),
            chip(s.tapTurn === true, tr('prefs.on'), () => savePrefs({ tapTurn: true })),
            chip(s.tapTurn === false, tr('prefs.off'), () => savePrefs({ tapTurn: false })),
          ),
          h('div', { className: 'dsh-moyu-prefs-row' },
            h('span', { className: 'dsh-moyu-prefs-label' }, tr('prefs.paper')),
            Object.keys(PAPERS).map((key) => chip(s.paper === key, h('span', { className: 'dsh-moyu-swatch' },
              h('span', {
                className: 'dsh-moyu-swatch-dot',
                style: PAPERS[key]
                  ? { background: PAPERS[key].bg, borderColor: 'var(--dsw-alias-border-l2)' }
                  : { background: 'var(--dsw-alias-bg-layer-2)' },
              }),
              tr(`prefs.paper.${key}`),
            ), () => savePrefs({ paper: key }), { title: tr(`prefs.paper.${key}`) })),
          ),
        ) : null,
        s.tocOpen ? h('div', { className: 'dsh-moyu-toc' },
          h('div', { className: 'dsh-moyu-toc-head' },
            h('input', {
              className: 'dsh-moyu-toc-search',
              type: 'search',
              value: s.tocQuery,
              placeholder: tr('toc.search'),
              'aria-label': tr('toc.search'),
              onChange: (event) => commit({ tocQuery: event.target.value }),
            }),
            h('span', { className: 'dsh-moyu-sub' }, tr('toc.count', { n: matches.length })),
            h('button', {
              type: 'button', className: 'dsh-moyu-btn', title: tr('toc.open'), 'aria-label': tr('toc.open'),
              onClick: () => commit({ tocOpen: false }),
            }, '×'),
          ),
          matches.length === 0
            ? h('div', { className: 'dsh-moyu-empty' }, tr('toc.empty'))
            : h('div', { className: 'dsh-moyu-toc-list' },
                matches.map(({ index, title }) => h('button', {
                  type: 'button',
                  key: `toc-${index}`,
                  className: index === s.index ? 'dsh-moyu-toc-item on' : 'dsh-moyu-toc-item',
                  'aria-current': index === s.index ? 'true' : undefined,
                  onClick: () => {
                    commit({ tocOpen: false, tocQuery: '' })
                    if (index !== s.index) void loadChapter(index, 0)
                  },
                },
                  h('span', { className: 'dsh-moyu-toc-index' }, String(index + 1)),
                  h('span', { className: 'dsh-moyu-toc-title' }, title),
                )),
              ),
        ) : null,
        h('div', { className: 'dsh-moyu-progress' },
          h('div', { className: 'dsh-moyu-progress-fill', style: { width: `${progress}%` } }),
        ),
      )
    }

    /**
     * The tab body. The pane owns the sizing, so this only fills it and picks
     * the current view out of the shared reader store.
     */
    function ShelfPane() {
      const s = useStore()

      useEffect(() => {
        readerVisible = true
        void resume()
        // Resolve whether dsh-novel is present before the empty state renders.
        void loadShelf()
        // The first paint of the pane is when the column becomes visible.
        return () => { readerVisible = false }
      }, [])

      const inReader = s.view === 'reader' && s.book

      return h('div', { className: 'dsh-moyu-pane' },
        h('style', null, CSS),
        // Reading owns the whole pane: the chapter title and the controls live
        // inside the reader, and the top bar is part of its toggleable chrome.
        inReader ? null : h('div', { className: 'dsh-moyu-pane-head' },
          h('div', { className: 'dsh-moyu-pane-title' }, tr('shelf.title')),
        ),
        s.error ? h('div', { className: 'dsh-moyu-error', role: 'alert' },
          h('span', { className: 'dsh-moyu-banner-text' }, s.error),
          h('button', {
            type: 'button', className: 'dsh-moyu-btn', title: tr('banner.dismiss'), 'aria-label': tr('banner.dismiss'),
            onClick: () => commit({ error: '' }),
          }, '×'),
        ) : null,
        s.notice ? h('div', { className: 'dsh-moyu-notice', role: 'status' },
          h('span', { className: 'dsh-moyu-banner-text' }, s.notice),
          h('button', {
            type: 'button', className: 'dsh-moyu-btn', title: tr('banner.dismiss'), 'aria-label': tr('banner.dismiss'),
            onClick: () => commit({ notice: '' }),
          }, '×'),
        ) : null,
        s.view === 'reader' ? h(ReaderView)
          : s.view === 'import' ? h(ImportView)
            : h(ShelfView),
      )
    }

    /* ------------------------------------------------------------- plugin */

    /** True while the bookshelf pane is rendered; blur-collapse checks it. */
    let readerVisible = false

    /** Bound from the layout service; null when this build has no such action. */
    let collapseRightbar = null

    /** Set by apply(): opening the shelf is `sidebarRight.openTab(kind)`. */
    let openShelfTab = () => {}

    return {
      inject: ['slots'],
      apply(ctx) {
        // The built-in dictionary covers both languages already; the service
        // adds the app's own switching, and it may arrive after this plugin.
        const bindLocale = (hostCtx) => {
          const locale = hostCtx.get('locale')
          if (!locale || typeof locale.register !== 'function') return
          hostCtx.effect(() => {
            const dispose = locale.register(NS, { zh: DICT.zh, en: DICT.en })
            boundTranslate = typeof locale.bind === 'function' ? locale.bind(NS) : null
            return () => {
              boundTranslate = null
              try { dispose?.() } catch { /* the registry may be gone */ }
            }
          }, 'moyu-novel: dictionaries')
        }
        try {
          if (typeof ctx.inject === 'function') ctx.inject(['locale'], bindLocale)
        } catch {
          /* fall through to the direct lookup */
        }
        if (boundTranslate === null) bindLocale(ctx)

        // Auto-hide needs the layout action; it is core, but resolve it through
        // the service instead of hoping `ctx.layout` happens to be attached.
        const bindLayout = (hostCtx) => {
          try {
            const layout = (typeof hostCtx.get === 'function' ? hostCtx.get('layout') : null) ?? hostCtx.layout
            if (layout && typeof layout.closeRightbar === 'function') {
              collapseRightbar = () => layout.closeRightbar()
            }
          } catch {
            /* the frame may not expose the action in this build */
          }
        }
        try {
          if (typeof ctx.inject === 'function') ctx.inject(['layout'], bindLayout)
        } catch {
          /* fall through to the direct lookup */
        }
        if (collapseRightbar === null) bindLayout(ctx)

        // Stage one: the tab type, plus the guide card that opens it. The
        // service is provisioned by ui-sidebar-right, which may activate after
        // this plugin, so the registration waits for it and re-runs on replacement.
        const registerType = (hostCtx) => {
          const registry = hostCtx.get('sidebarRightTabs')
          if (!registry || typeof registry.register !== 'function') return
          hostCtx.effect(() => {
            try {
              return registry.register({
                id: TAB_ID,
                kind: TAB_KIND,
                title: () => tr('tab.title'),
                guide: [{
                  id: 'shelf',
                  order: 30,
                  title: () => tr('tab.title'),
                  icon: GuideIcon,
                }],
              })
            } catch (error) {
              console.warn('[moyu-novel] tab type registration failed:', error)
              return () => {}
            }
          }, 'moyu-novel: sidebar tab type')
        }

        if (typeof ctx.inject === 'function') {
          ctx.inject(['sidebarRightTabs'], registerType)
          ctx.inject(['sidebarRight'], (hostCtx) => {
            openShelfTab = () => {
              try {
                hostCtx.sidebarRight.openTab(TAB_KIND)
              } catch (error) {
                console.warn('[moyu-novel] cannot open the shelf tab:', error)
              }
            }
          })
        } else {
          registerType(ctx)
          const sidebarRight = ctx.get('sidebarRight')
          openShelfTab = () => {
            try { sidebarRight?.openTab(TAB_KIND) } catch { /* ignore */ }
          }
        }

        // Stage two: the pane body under the same id.
        try {
          ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
            name: 'sidebar.right.pane.tab',
            key: TAB_ID,
          }, ShelfPane))
        } catch (error) {
          console.warn('[moyu-novel] pane body unavailable:', error)
        }

        // One more way in, next to Settings: it opens the same tab.
        try {
          ctx.slots.inject('settings.general.item', () => ctx.slots.register({
            name: 'settings.general.item',
            id: 'moyu-novel',
            order: 50,
          }, SettingsRow))
        } catch (error) {
          console.warn('[moyu-novel] settings row unavailable:', error)
        }

        // Auto-hide: losing the window collapses the column. The tab stays in
        // the session layout, so the native expand control brings the same
        // chapter back without any custom handle.
        ctx.effect(() => {
          const hide = () => {
            if (!readerVisible || collapseRightbar === null) return false
            try {
              collapseRightbar()
              return true
            } catch {
              /* the frame may not expose the action in this build */
              return false
            }
          }
          // Chromium throttles the render that applies a state change while the
          // window sits in the background, so the collapse can end up landing
          // only when the user comes back. Ask again on a short timer: the point
          // is that the column is gone *while* you are away.
          let retries = []
          const dropRetries = () => {
            for (const timer of retries) clearTimeout(timer)
            retries = []
          }
          const leave = () => {
            dropRetries()
            if (!hide()) return
            retries = [120, 400, 1200].map((delay) => setTimeout(() => {
              if (document.hasFocus?.() === true) return
              hide()
            }, delay))
          }
          const onBlur = (event) => {
            if (event.target !== window && event.target !== document) return
            leave()
          }
          const onVisibility = () => { if (document.hidden) leave() }
          const onPageHide = () => leave()
          // Some frames deliver the departure as a focusout with no next target
          // rather than a window blur; `hasFocus()` keeps a click on empty page
          // space from being mistaken for one.
          const onFocusOut = (event) => {
            if (event.relatedTarget !== null) return
            if (document.hasFocus?.() === false) leave()
          }
          const onKeyDown = (event) => {
            if (event.key !== 'Escape' || event.defaultPrevented) return
            if (state.tocOpen) {
              event.preventDefault()
              commit({ tocOpen: false, tocQuery: '' })
            } else if (state.prefsOpen) {
              event.preventDefault()
              commit({ prefsOpen: false })
            }
          }
          window.addEventListener('blur', onBlur, true)
          document.addEventListener('focusout', onFocusOut, true)
          document.addEventListener('visibilitychange', onVisibility, true)
          window.addEventListener('pagehide', onPageHide, true)
          window.addEventListener('keydown', onKeyDown, true)
          return () => {
            dropRetries()
            window.removeEventListener('blur', onBlur, true)
            document.removeEventListener('focusout', onFocusOut, true)
            document.removeEventListener('visibilitychange', onVisibility, true)
            window.removeEventListener('pagehide', onPageHide, true)
            window.removeEventListener('keydown', onKeyDown, true)
            if (progressTimer !== null) {
              clearTimeout(progressTimer)
              progressTimer = null
            }
          }
        }, 'moyu-novel: hide on blur')
      },
    }
  },
})
