# Embed Link Converter

[English](#english) | [中文](#中文)

---

## English

Converts between Obsidian's **wiki-link embeds** (`![[图片.png]]`) and **standard Markdown images** (`![alt](path)`) in both directions.

You can pilot the conversion in a single folder first, then clear the setting to run it across the whole vault. Every run opens a preview modal that lists each change before anything is written, and the original files are backed up automatically.

### Core design: rewrite the syntax, never the path

This plugin **only rewrites the syntax of an embed and never rewrites the link target**. Every character of the path is preserved as-is.

```
![[attachments/图表 1.png]]          →  ![](<attachments/图表 1.png>)
![[attachments/图表 1.png|300]]      →  <img src="attachments/图表 1.png" width="300">
![[attachments/图表 1.png|标题|640x480]] → <img src="attachments/图表 1.png" alt="标题" width="640" height="480">
```

This is a deliberate choice. Rewriting paths (say, resolving a short name to `../attachments/x.png`) looks tidier, but it has two unacceptable consequences: a miscalculated link is **permanently broken**, and the conversion is **irreversible**. Keeping the path untouched means converting there and back is byte-for-byte identical.

Filenames with spaces or parentheses are automatically wrapped in `<>` (accepted by both CommonMark and Obsidian), so `![[Screenshot (2).png]]` → `![](<Screenshot (2).png>)` converts back unchanged. The naive regex `\(([^)]*)\)` truncates at the first `)`, and such filenames are extremely common in real vaults.

#### What happens to size parameters

Standard Markdown has no image-size syntax, so `|300` has to go somewhere. Three options:

| Option | `![[a.png\|300]]` becomes | Notes |
|---|---|---|
| **HTML `<img>` tag** (default) | `<img src="a.png" width="300">` | Renders in any Markdown renderer; reversible |
| Drop it | `![](a.png)` | Simplest; the size is lost |
| Write into alt text | `![\|300](a.png)` | Obsidian-specific; reversible but not portable Markdown |

With the alt-text option, the `\|` is kept even when the caption is empty (written as `![\|300]`), otherwise `![300](a.png)` would be read as the caption "300" and could not be converted back.

### Scope: pilot vs whole vault

Leaving the **folder setting empty means the whole vault**; filling it in limits the run to that folder. These are two uses of the same code path.

- Recommended flow: fill in a subfolder to pilot → inspect the real diffs in the preview → clear the field to run on the whole vault once confirmed
- "Include subfolders" controls recursion
- Dot-directories such as `.obsidian` and `.trash` are always excluded
- Setting the path to a **file** processes just that file; a **non-existent folder** aborts with an error and does **not** silently widen to the whole vault

If you would rather not touch settings, use the "current note" / "current folder" commands from the command palette.

### Non-image embeds

"Which embeds to process" decides whether things other than images take part:

| Option | Behaviour |
|---|---|
| **Images only** (default) | Only png/jpg/gif/svg/webp/bmp/avif etc. The only scope that never changes rendered output |
| Images + attachments | Adds PDF, audio/video, canvas, archives, xlsx etc., but **never notes** |
| Everything (incl. note embeds) | Even `![[Some Note]]` is converted to a plain link |

The last option **changes how notes render** — a note embed is an inline excerpt, a plain link is just a link. That is why it is off by default; when enabled, the preview modal reports separately how many note embeds were changed.

### Safety

1. **Preview**: a modal before writing, listing the real before → after diff per file, expandable to every single change.
2. **Backup**: before writing, each file to be modified is copied to `.obsidian/plugins/embed-link-converter/backups/<timestamp>/`; the directory name is the timestamp.
3. **Retention**: backups older than the configured number of days are deleted automatically after each conversion (default 7 days; set 0 to keep forever).
4. **Rollback**: "Roll back the last conversion" in settings restores from the most recent backup. Timestamps are in the directory names, so the newest backup sorts first — the plugin does not need to maintain a pointer.
5. **Backup failure aborts everything**: if a backup cannot be written, the conversion is abandoned without changing a single file.

Backup directory names are only recognised in the plugin's own format; directories it cannot recognise are never deleted.

### What it never touches

- Embeds inside fenced code blocks (``` ``` ``` and `~~~`)
- Inline code `` `![[x.png]]` ``
- YAML frontmatter fields
- Remote images (`![](https://…)`, `![](data:…)`)
- Reference-style images `![a][ref]`
- Images with titles `![a](x.png "Title")` — converting to a wiki link would lose the title, so they are left as-is
- `<img src="a.png" width="50%">` — `50%` has no Obsidian equivalent, so it is left as-is
- Links whose paths contain `<` `>` — cannot be expressed safely, so they are not converted

> An unclosed `---` at the start is treated as a horizontal rule, following Obsidian's own behaviour, so embeds in such notes are still converted.

### Commands

| Command | What it does |
|---|---|
| Wiki embed → Markdown image (per settings scope) | The first direction, using the configured folder / whole-vault scope |
| Markdown image → wiki embed (per settings scope) | The reverse direction |
| Current note: … (both directions) | Processes only the currently open note |
| Current folder: … (both directions) | Processes only the folder of the current note |
| Roll back the last conversion | Restores from the most recent backup |

The ribbon icon runs "wiki → Markdown" by default.

### A note on parameter order

Obsidian's parameter order is **caption first, then size**: `![[image.jpg\|caption\|300]]`. Cross-checked against two sources:

- The 0.9.4 changelog quoted on the Obsidian forum: Markdown images are written `![AltText\|100x100](image.png)`, embeds are written `![[image\|100x100]]`
- The `obsidian-image-captions` plugin README: `![[image.jpg\|This is a caption\|center]]`

The plugin writes in this order and reads it back in this order; the reverse parser tolerates both orders.

### Installation

```bash
cd code/obsidian-embed-link-converter
npm install
npm run build
```

The build produces `main.js` + `manifest.json` + `styles.css`. Deploy to a vault:

```bash
OUTDIR="/path/to/your/vault/.obsidian/plugins/embed-link-converter" npm run build
```

Or copy those three files manually to `<vault>/.obsidian/plugins/embed-link-converter/` and enable the plugin in Obsidian.

### Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # 216 tests
npm run dev         # watch rebuild
```

#### Code structure

| File | Responsibility |
|---|---|
| `src/constants.ts` | Extension classification (images / attachments / notes) |
| `src/segments.ts` | Splits the document into editable and non-editable regions (frontmatter, code blocks, inline code) |
| `src/markdown-image.ts` | Hand-written scanners for Markdown images and HTML `<img>` |
| `src/wiki-embed.ts` | Parsing and assembling wiki-link embeds |
| `src/converter.ts` | Orchestration of both directions (pure functions, no Obsidian dependency) |
| `src/scope.ts` | Decides which files are in scope |
| `src/planner.ts` | Builds a previewable change plan |
| `src/backup.ts` | Timestamped backups, expiry cleanup, rollback |
| `src/previewModal.ts` | Preview confirmation modal |
| `src/SettingsTab.ts` | Settings UI |
| `src/main.ts` | Commands, run flow |

All conversion logic consists of pure functions with no Obsidian dependency, so the rewrite rules can be unit-tested without a vault — that is where the risk concentrates anyway.

#### Tests

```
tests/
├── converter.test.ts        # 双向转换规则、范围开关
├── markdown-image.test.ts   # 两个扫描器与双链解析器
├── segments.test.ts         # 代码块 / frontmatter / 行内代码
├── roundtrip.test.ts        # 18 种语法逐条往返一致
├── scope.test.ts            # 范围解析，含错误路径
├── planner.test.ts          # 计划生成
├── backup.test.ts           # 时间戳、过期、回滚、路径安全
├── settings.test.ts         # 备份目录由 configDir 推导
├── settingsTab.test.ts      # 声明式设置（1.13+ 设置搜索）
└── e2e-filesystem.test.ts   # 真实目录、真实文件名、真实落盘往返
```

`roundtrip.test.ts` is this plugin's core promise: every supported syntax must survive a round trip byte-for-byte. `e2e-filesystem.test.ts` verifies the same thing on a real filesystem, using Chinese paths, spaces, parentheses, and CRLF.

#### Two easy-to-miss details

**The settings page has two renderers but only one definition.** `getSettingDefinitions()` (Obsidian 1.13.0+) and `display()` (every version before 1.13) both read from the same `spec()`, because they describe the same settings — writing them twice would eventually drift. Omitting the former does not raise an error; the settings are merely not searchable, so `settingsTab.test.ts` asserts that every persisted field appears in the declarative definitions.

**The backup directory follows `Vault#configDir`.** The `.obsidian` name can be changed by the user; hard-coding it would write backups somewhere the vault root never looks, while the rollback button would quietly report "no backups found". Both absolute and relative path forms are tested.

### License

MIT

### Issues & Feedback

- GitHub Issues: https://github.com/yanqingwang/obsidian-embed-link-converter/issues
- Email: wangyantsing@qq.com

---

## 中文

在 Obsidian 的**双链嵌入**（`![[图片.png]]`）和**标准 Markdown 图片**（`![alt](path)`）之间双向转换。

可以先在一个文件夹里试点，确认结果后再清空设置对整个 vault 执行。每次转换前都会弹预览窗口逐条列出改动，并自动备份原文件。

### 核心设计：只换语法，不改路径

这个插件**只改写嵌入的语法形式，绝不重写链接目标**。路径里的每一个字符都原样保留。

```
![[attachments/图表 1.png]]          →  ![](<attachments/图表 1.png>)
![[attachments/图表 1.png|300]]      →  <img src="attachments/图表 1.png" width="300">
![[attachments/图表 1.png|标题|640x480]] → <img src="attachments/图表 1.png" alt="标题" width="640" height="480">
```

这是刻意的选择。重写路径（比如把短名解析成 `../attachments/x.png`）看起来更"规范"，但它有两个不可接受的后果：链接一旦算错就**永久失效**，而且转换**不可逆**。保持路径原样，意味着转过去再转回来逐字节一致。

含空格或括号的文件名会自动包进 `<>`（CommonMark 与 Obsidian 都接受），所以 `![[Screenshot (2).png]]` → `![](<Screenshot (2).png>)` 能原样转回来。普通的正则 `\(([^)]*)\)` 会在第一个 `)` 处截断，这种文件名在实际 vault 里非常普遍。

#### 尺寸参数怎么办

标准 Markdown 没有图片尺寸语法，`|300` 必须有个去处。三个选项：

| 选项 | `![[a.png|300]]` 变成 | 说明 |
|---|---|---|
| **HTML `<img>` 标签**（默认） | `<img src="a.png" width="300">` | 通用渲染器都能显示，可逆 |
| 直接丢弃 | `![](a.png)` | 最简洁，尺寸丢失 |
| 写入 alt 文本 | `![\|300](a.png)` | Obsidian 自有写法，可逆但不是通用 Markdown |

用 alt 文本那一项时，即使标题为空也会保留 `|`（写成 `![|300]`），否则 `![300](a.png)` 会被读成标题"300"而无法转回来。

### 范围：试点 vs 全库

设置里的**文件夹留空 = 整个 vault**，填了就是只在该文件夹内执行。这是同一个代码路径的两种用法。

- 建议流程：先填一个子文件夹试点 → 看预览里的真实 diff → 确认无误后清空这一栏跑全库
- 「包含子文件夹」控制是否递归
- `.obsidian`、`.trash` 等点目录永远被排除
- 把路径填成某个**文件**时只处理该文件；填一个**不存在的文件夹**会直接报错中止，**不会**悄悄扩大到全库

不想改设置也可以直接用命令面板里的「当前笔记」/「当前文件夹」版本。

### 非图片嵌入

「处理哪些嵌入」决定除图片以外的东西是否参与转换：

| 选项 | 行为 |
|---|---|
| **仅图片**（默认） | 只处理 png/jpg/gif/svg/webp/bmp/avif 等。唯一不改变渲染结果的范围 |
| 图片 + 附件 | 加上 PDF、音视频、canvas、压缩包、xlsx 等，但**不动笔记** |
| 全部（含笔记转嵌） | 连 `![[Some Note]]` 也转成普通链接 |

最后一项会**改变笔记的渲染结果**——转嵌是一段内联的摘录，普通链接只是一个链接。所以它默认关闭，开启后预览窗口会单独标出有多少条笔记转嵌被改。

### 安全

1. **预览**：写入前弹窗，逐文件列出真实的 before → after 差异，可以展开查看每一处。
2. **备份**：写入前把每个待改文件的原文件复制到 `.obsidian/plugins/embed-link-converter/backups/<时间戳>/`，目录名即时间戳。
3. **保留期**：超过设定天数的备份在每次转换后自动删除（默认 7 天，设为 0 永久保留）。
4. **回滚**：设置里的「回滚上一次转换」用最近一次备份覆盖回来。时间戳在目录名里，所以最新的备份排序就是最新的，不需要插件自己维护指针。
5. **备份失败即中止**：如果备份写不成功，转换直接放弃，一个文件都不改。

备份文件夹名只认插件自己创建的格式；认不出来的目录永远不会被删除。

### 不会碰的东西

- 代码块（``` ``` ``` 和 `~~~`）里的嵌入
- 行内代码 `` `![[x.png]]` ``
- YAML frontmatter 里的字段
- 远程图片（`![](https://…)`、`![](data:…)`）
- 引用式图片 `![a][ref]`
- 带标题的图片 `![a](x.png "Title")` —— 转成双链会丢标题，所以原样保留
- `<img src="a.png" width="50%">` —— `50%` 在 Obsidian 里没有对应写法，所以原样保留
- 路径里含 `<` `>` 的链接 —— 无法安全表达，宁可不转

> 未闭合的 `---` 开头按 Obsidian 的做法当作水平分割线处理，所以这种笔记里的嵌入仍然会被转换。

### 命令

| 命令 | 作用 |
|---|---|
| 双链嵌入 → Markdown 图片（按设置范围） | 用设置的文件夹/全库范围，双向转换的第一个方向 |
| Markdown 图片 → 双链嵌入（按设置范围） | 反方向 |
| 当前笔记：…（两个方向） | 只处理当前打开的笔记 |
| 当前文件夹：…（两个方向） | 只处理当前笔记所在文件夹 |
| 回滚上一次转换 | 从最近的备份恢复 |

功能区图标默认执行「双链 → Markdown」。

### 参数顺序说明

Obsidian 的参数顺序是 **先标题后尺寸**：`![[image.jpg|caption|300]]`。这一点经两个来源交叉验证：

- Obsidian 论坛引用的 0.9.4 更新日志：Markdown 图片写 `![AltText|100x100](image.png)`，嵌入写 `![[image|100x100]]`
- `obsidian-image-captions` 插件 README：`![[image.jpg|This is a caption|center]]`

插件按这个顺序写出，也按这个顺序读回；反向解析对两种顺序都容错。

### 安装

```bash
cd code/obsidian-embed-link-converter
npm install
npm run build
```

产物是 `main.js` + `manifest.json` + `styles.css`。部署到 vault：

```bash
OUTDIR="/path/to/your/vault/.obsidian/plugins/embed-link-converter" npm run build
```

或者手动复制这三个文件到 `<vault>/.obsidian/plugins/embed-link-converter/`，然后在 Obsidian 里启用。

### 开发

```bash
npm run typecheck   # tsc --noEmit
npm test            # 216 个测试
npm run dev         # 监听重建
```

#### 代码结构

| 文件 | 职责 |
|---|---|
| `src/constants.ts` | 扩展名分类（图片 / 附件 / 笔记） |
| `src/segments.ts` | 把文档切成「可改」和「不可改」的区域（frontmatter、代码块、行内代码） |
| `src/markdown-image.ts` | Markdown 图片与 HTML `<img>` 的手写扫描器 |
| `src/wiki-embed.ts` | 双链嵌入的解析与拼装 |
| `src/converter.ts` | 双向转换的编排（纯函数，不依赖 Obsidian） |
| `src/scope.ts` | 决定哪些文件在范围内 |
| `src/planner.ts` | 生成可预览的改动计划 |
| `src/backup.ts` | 时间戳备份、过期清理、回滚 |
| `src/previewModal.ts` | 预览确认窗口 |
| `src/SettingsTab.ts` | 设置界面 |
| `src/main.ts` | 命令、运行流程 |

转换逻辑全部是不依赖 Obsidian 的纯函数，所以改写规则可以脱离 vault 单测——风险本来就集中在这里。

#### 测试

```
tests/
├── converter.test.ts        # 双向转换规则、范围开关
├── markdown-image.test.ts   # 两个扫描器与双链解析器
├── segments.test.ts         # 代码块 / frontmatter / 行内代码
├── roundtrip.test.ts        # 18 种语法逐条往返一致
├── scope.test.ts            # 范围解析，含错误路径
├── planner.test.ts          # 计划生成
├── backup.test.ts           # 时间戳、过期、回滚、路径安全
├── settings.test.ts         # 备份目录由 configDir 推导
├── settingsTab.test.ts      # 声明式设置（1.13+ 设置搜索）
└── e2e-filesystem.test.ts   # 真实目录、真实文件名、真实落盘往返
```

`roundtrip.test.ts` 是这个插件的核心承诺：每一种受支持的语法，转过去再转回来必须逐字节一致。`e2e-filesystem.test.ts` 在真实文件系统上验证同一件事，用的是中文路径、空格、括号、CRLF。

#### 两处容易被忽略的地方

**设置页有两套渲染，但只有一份定义。** `getSettingDefinitions()`（Obsidian 1.13.0+）和 `display()`（1.13 之前的全部版本）都读同一个 `spec()`，因为它们描述的是同一批设置，写两遍迟早会漂移。少实现前者不会报错——设置只是搜不到，所以 `settingsTab.test.ts` 断言每个持久化字段都出现在声明式定义里。

**备份目录跟着 `Vault#configDir` 走。** `.obsidian` 这个名字是可以被用户改掉的；硬编码会把备份写到 vault 根本不看的地方，而回滚按钮只会安静地报告「没有找到任何备份」。绝对路径和相对路径两种形态都有测试。

### 许可

MIT

### 问题与反馈

- GitHub Issues: https://github.com/yanqingwang/obsidian-embed-link-converter/issues
- 邮箱：wangyantsing@qq.com
