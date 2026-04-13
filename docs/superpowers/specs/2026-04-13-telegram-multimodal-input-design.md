# Telegram Multimodal Input Design

日期：2026-04-13

## 目标

为 shellRaining 增加 Telegram-first 的多模态输入 happy path，让用户可以通过 Telegram 发送图片、文件、贴纸和语音消息，并让 Pi CodingAgent 在同一个线程会话里理解这些输入。

## 关键设计结论

- 保持 Pi CodingAgent 是唯一执行内核，Chat SDK 仍只作为 Telegram transport 和消息抽象层。
- 第一版默认当前模型支持图片输入，不做模型能力探测或图片降级路径。
- 文件输入先按路径处理，不在 shellRaining 内实现 TXT、PDF、XLSX 等文件解析。
- 语音输入只做可插拔 STT 层，不在本项目内绑定具体模型或部署方案。
- 普通 emoji 保留在文本中；sticker 先转成轻量文本描述，不下载 sticker 图像。
- 附件状态统一落在 `~/.shellRaining/` 下，不引入 `.mini-claw` 路径。

## 系统边界

用户通过 Telegram 私聊、mention、已订阅线程发送文本、caption、图片、文件、语音或贴纸。shellRaining 负责把 Telegram 消息归一化成 Pi 可消费的文本 prompt、图片内容块和本地附件路径。Pi 负责按需读取、分析、转换或处理文件。

本设计不沉淀文件读取 skill，也不选择具体 STT 服务。后续可以单独评估已有文件处理 skill，或新增一个 Telegram 附件/文件处理 skill。

## 架构

### 1. Telegram Input Normalizer

新增输入归一化模块，接收 Chat SDK 的 `Message` 和当前线程信息，输出一个 `NormalizedTelegramInput`：

- `text`: 给 Pi 的最终文本 prompt。
- `images`: Pi SDK `ImageContent[]`，来自 Telegram image/photo 附件。
- `savedFiles`: 已下载到本地的附件元数据。
- `warnings`: 非阻塞问题，例如某个附件下载失败或 STT 未配置。

归一化模块只做 Telegram 输入到 Pi 输入的桥接，不调用 Pi session，不处理业务命令。

### 2. Attachment Storage

所有可下载附件保存到：

```text
~/.shellRaining/inbox/<thread-key>/<message-id>/<safe-filename>
```

文件名使用 Telegram 原始文件名时必须做安全化；没有文件名时使用附件类型、message id 和扩展名生成。第一版只实现 happy path，但仍保留基础防护：创建目录、避免路径穿越、避免空文件名覆盖、保留原始 MIME type 和 size 元数据。

### 3. Image Input

当 `message.attachments` 中出现 `type: "image"` 的附件：

- 调用 `fetchData()` 下载图片。
- 保存到 attachment storage，方便后续追踪。
- 转成 Pi SDK 的 `{ type: "image", data, mimeType }` 并传给 `session.prompt(text, { images })`。
- 在 prompt 中加入图片来源路径，例如 `[Telegram image: /abs/path/image.jpg]`。

第一版不探测模型是否支持图片；如果 provider 后续报错，再单独设计 fallback。

### 4. File Input

当 Telegram document 或其他非图片文件进入时：

- 下载并保存到 attachment storage。
- 不在 shellRaining 内读取、解析或摘要 TXT/PDF/XLSX。
- 在 prompt 中加入附件列表和绝对路径，例如：

```text
[Telegram attachments]
- report.pdf (application/pdf): /Users/shellraining/.shellRaining/inbox/telegram__123__456/789/report.pdf
- sheet.xlsx (application/vnd.openxmlformats-officedocument.spreadsheetml.sheet): /Users/shellraining/.shellRaining/inbox/telegram__123__456/789/sheet.xlsx
```

Pi 的 `read` 和 `bash` 工具支持绝对路径，因此 Pi 可以根据用户意图自行读取、转换或分析。后续如果沉淀文件处理 skill，应优先复用 Pi 原生 skills 配置，而不是在 shellRaining 中建立平行 skill registry。

### 5. Voice And Audio Input

语音消息和普通音频附件都先下载到 attachment storage。

新增可插拔 STT 配置：

- `SHELL_RAINING_STT_BASE_URL`
- `SHELL_RAINING_STT_API_KEY`
- `SHELL_RAINING_STT_MODEL`

当 `SHELL_RAINING_STT_BASE_URL` 存在时，shellRaining 调用 OpenAI-compatible `POST /v1/audio/transcriptions`，把返回 transcript 放入 prompt：

```text
[Telegram voice transcript]
今天把会议纪要整理一下。

[Telegram audio file]
/abs/path/voice.ogg
```

当 STT 未配置或调用失败时，不阻塞整条消息；prompt 只包含音频文件路径和 warning，交给 Pi 或用户后续处理。

### 6. Emoji And Sticker Input

普通 emoji 作为 Unicode 文本保留在 `message.text` 或 caption 中。

Telegram sticker 第一版从 `message.raw.sticker` 读取 `emoji` 和基础元数据，生成文本提示：

```text
[Telegram sticker: emoji=🙂]
```

不下载 sticker 图像，不修改 Chat SDK adapter。若后续需要视觉理解 sticker，再考虑在 `@chat-adapter/telegram` 中把 sticker 暴露为附件。

### 7. Pi Prompt Bridge

`PiRuntime.prompt()` 扩展为接受可选图片输入，并调用 Pi SDK：

```ts
session.prompt(text, { images })
```

`bot.ts` 的三个消息入口继续共用同一条处理路径：鉴权、订阅、命令处理、归一化输入、限流、Pi prompt、回复和输出文件检测。命令仍只基于文本触发；纯附件消息不会被误判为空命令。

### 8. System Prompt Guidance

在现有 environment profile 或相邻的 Pi system prompt 附加内容中加入 Telegram 附件约定：

- 收到 `[Telegram attachments]` 时，根据用户意图决定是否读取文件。
- 不要声称已阅读未读取的附件。
- 对 PDF、XLSX、DOCX 等文件，可使用 bash 或已有工具进行转换、检查或抽取。
- 附件路径来自本地 `~/.shellRaining/inbox/`，可直接通过绝对路径访问。

这只是轻量指导，不替代未来的文件处理 skill。

## 错误处理

第一版以 happy path 为主，但需要明确非阻塞行为：

- 附件下载失败：继续处理文本和其他附件，在 prompt 中加入 warning。
- 图片缺少 MIME type：使用 Telegram 元数据或 `application/octet-stream` 兜底；若无法构造 Pi image block，则只保留文件路径。
- STT 未配置：不报错，只把音频文件路径交给 Pi。
- STT 调用失败：保留文件路径和 warning，不阻断用户消息。
- 归一化后没有文本、图片、文件、语音或贴纸内容：回复用户说明未识别到可处理内容，不调用 Pi。

## 测试策略

新增 focused tests：

- 输入归一化：文本、caption、普通 emoji 会进入 prompt。
- 图片附件：下载后生成 `images`，同时保存本地路径。
- 文件附件：PDF、TXT、XLSX 只生成路径提示，不做内容解析。
- 语音附件：STT 配置存在时 transcript 进入 prompt；未配置时只给音频路径。
- sticker：raw sticker emoji 生成文本描述。
- bot routing：纯附件消息不会变成空 prompt；命令消息仍按现有命令逻辑处理。
- Pi runtime：`images` 参数会传给 `session.prompt()`。

现有 `pnpm test` 和 `pnpm typecheck` 仍是完成实现前的基础验证命令。

## 非目标

- 不实现文件内容解析器。
- 不选择或部署具体 STT 模型。
- 不探测或切换模型多模态能力。
- 不下载 sticker 图像。
- 不增加独立 skill registry。
- 不处理 Telegram reactions 作为 agent 输入。

## 后续方向

- 调研或沉淀文件处理 skill，用于 PDF、XLSX、DOCX、PPTX、压缩包等文件类型。
- 评估 OpenAI-compatible STT 服务，例如 Speaches、LocalAI，或基于 faster-whisper / whisper.cpp 的自托管服务。
- 在模型不支持图片输入时增加 fallback：只保留图片路径，或让 Pi 通过 read 工具读取图片。
- 将 sticker 暴露为 Telegram adapter attachment，让视觉模型可以理解贴纸图像。
