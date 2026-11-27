# 书架 / dsh-moyu-novel

DSH 右侧栏里的小说阅读标签页：和「工作区文件 / 浏览器 / 终端」并列在「开始」页，**窗口一失焦整个右栏收起**，切回来屏幕上什么都不剩。
没有老板键、没有托盘、没有常驻悬浮窗；切回来用 DSH 自带的右栏展开按钮一键接上。

## 安装

在 DSH 的 **插件 → 添加插件** 里选择本目录（本地目录安装），或把包发布到 npm 后安装：

```
npm publish        # 包名 dsh-moyu-novel
```

装好后刷新页面并**新开一个会话**。

## 用起来

1. 打开右侧栏 → **开始**（罗盘页）→ **书架**。也可以走 设置 → 通用 → 书架。
   标签页和原生的一样：可拖动、分屏、浮动；关掉后从同一张卡片再开。
2. 书从哪来：
   - 对 AI 说「帮我找《书名》，下到书架」——AI 会搜索、找到可下载的 TXT/EPUB 或章节页，再调用插件工具入库；
   - 书架页底部「从 dsh-novel 导入」，把那个插件已经缓存好的整本书搬过来；
   - 直接调用工具导入本地文件 / 网页 / 正文。
3. 读书：顶栏（书名 + 章号）和底栏（上一章 / 目录 / 跳章 / Aa / 下一章）常驻且不压正文；正文末尾还有一颗「下一章 ›」。`Aa` 里可调**字号 / 行距 / 段距 / 首行缩进 / 字体 / 纸张（含夜间）**，以及**点击翻页**开关（默认关，滚轮党不受影响）。进度自动存，下次从原处继续。
4. 切走窗口（Alt+Tab、切标签页、最小化）→ 右栏整个收起。切回来拉出右栏，书架还在原处。

## AI 工具

| 工具 | 作用 |
|---|---|
| `moyu_novel_library` | 列书架、看进度 |
| `moyu_novel_import` | 导入：`file`（txt/epub/html）/ `url` / `text` / `cache`（dsh-novel 缓存） |
| `moyu_novel_download` | 按章节 URL 批量抓正文入库，一次最多 40 章 |
| `moyu_novel_read` | 读某一章（核对、摘录） |
| `moyu_novel_remove` | 删书 |

## 配置

`cordis.patch.yml` 里这一行可加 `config`：

```yaml
- id: moyu-novel
  name: dsh-moyu-novel
  config:
    libraryDir: 'D:\novels\moyu'   # 默认 ~/.dsh/moyu-novel
```

当前版本没有导出 `Config` schema：这个键按运行时兜底读取，不进插件设置界面，也不会在保存时校验。

## 参考与致谢

界面约定不是凭空发明的，是照着这些开源项目学来的——**只借鉴交互与阅读页的做法，没有复制它们的代码**：

- [legado / 阅读](https://github.com/gedoor/legado) —— Android 上最流行的开源小说阅读器，阅读页的规矩基本照它：点屏幕左右翻屏、中间呼出控制条，字号 / 行距 / 段距 / 首行缩进 / 字体 / 纸张（含夜间），底部细进度线。
- [xrn1997/dsh-novel](https://github.com/xrn1997/dsh-novel) —— DSH 里的网络小说插件。书架可直接导入它的下载缓存（目录与正文的缓存文件命名格式完全兼容），纸张色那套偏好也参考了它。
- [LaoganR/dsh-novel-reader](https://github.com/LaoganR/dsh-novel-reader)、[XIAOZHAOXSXH/dsh-moyu-reader](https://github.com/XIAOZHAOXSXH/dsh-moyu-reader) —— 更早把阅读器放进 DSH 右侧栏的尝试，验证了这个位置可行。

## 数据与边界

- 书和进度都在本机 `~/.dsh/moyu-novel/`（每本书一个目录，正文按章存 txt）。
- 插件不含书源；抓取只在你或 AI 明确要求导入/下载时发生。
- EPUB 支持无 DRM 的版本（ZIP + OPF spine）；DRM、固定版式不处理。
- 本地接口挂在 DSH 自己的 Web 服务上：`/moyu-novel/api/*`。
- 仅供个人已获授权内容的阅读，抓取请自觉限速，站点版权归各自权利人所有。

## 开发

```
node --check index.js client.js lib/*.js
```

`lib/` 里是纯函数（分章、HTML 正文提取、EPUB 解析、书库读写），不依赖任何第三方包。
