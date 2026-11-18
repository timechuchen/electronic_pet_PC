# 兰洛 AI 陪伴第一版

## 使用

1. 先退出正在运行的旧版兰洛桌宠。
2. macOS 双击项目根目录的 `启动AI桌宠.command`。这是使用本机已安装 Electron/Python 环境的开发版入口。
3. 鼠标移到人物上方，点击 **聊天**；也可以使用托盘菜单“和兰洛聊聊…”或 `Cmd/Ctrl + J`。
4. 展开“连接设置”，填写自己的 DeepSeek API Key，保存后点击“测试连接”。测试调用模型列表，不生成聊天回复。
5. 输入文字，Enter 发送、Shift + Enter 换行。可以停止请求；失败保留输入，方便自行重试。
6. 开启“自动朗读回复”并保存，或者点击某条回复的“朗读这条”。“停止朗读”可以随时打断。

第一版支持 **文字输入 → AI 回复 → 人物气泡、身体动作和表情 → 可选系统朗读**。尚未接入麦克风转写；可以在输入框使用操作系统提供的听写。系统中文声音缺失时会显示提示，文字聊天仍可使用。只有桌宠窗口播放声音，聊天窗口不会重复播放。

`releases/v1.2.0/` 已包含本功能的独立应用。Windows 实机运行及语音声音需要单独验收。

## 项目分析与实现选择

项目包含两套实现：`project/` 是 Python + WebKit 原始版本，`packaging/` 是 Electron + Python + Three.js/three-vrm 的独立版本。后者有 Mac/Windows 外壳和自定义动作库，因此 AI 功能实现在 `packaging/` 中。

- Three.js/VRM 继续渲染人物；Python 控制骨骼、表情、音乐、摄像头优先级，并通过 SSE 同步所有人物窗口。
- Electron 主进程负责 Key、对话历史和 DeepSeek 请求。渲染页面只通过有限 IPC 调用访问聊天，保存后不会收到明文 Key。
- 新增独立聊天窗口，桌宠继续保持原来的尺寸和透明背景。主设置页、桌宠工具条、应用菜单和托盘都有聊天入口。
- 回复采用 JSON 协议，一次返回文本、情绪标签、身体动作和表情；只允许已有动作。当前为完整回复后显示，不是流式逐字输出。
- 角色指令以情绪陪伴为核心：倾听、安慰、具体鼓励、分享日常和轻松闲聊。自我介绍只讲陪伴，不推荐写代码、文案、查资料等工具能力；不急着解决问题，不强迫积极，不每句都追问，也不编造共同经历或持久记忆。JSON 回复与纯文字兜底共用同一套角色提示。近期对话提供上下文，未实现长期偏好记忆。

```text
文字输入 → 受限 IPC → Electron ChatService → DeepSeek
                                      ↓ 校验回复 JSON
                         聊天窗口 + 桌宠气泡 + 系统朗读
                                      ↓ 私有本机接口
                       Python 动作仲裁 → SSE → VRM 人物
```

## 动作与情绪

协议示例：

```json
{"reply":"今天真的辛苦了，想说说最让你累的那件事吗？","emotion":"concerned","action":"nod","expression":"neutral"}
```

身体动作允许 `none / wave / nod / shake / dance / jump`，表情允许 `neutral / smile / wink / blink`。未知动作回退为空动作；不执行模型提供的代码、命令、文件路径或自定义脚本。`emotion` 是对话元数据，不代表新增了模型没有的悲伤等面部形变。

AI 动作是单次反应，不继承手动“循环”开关。手动动作和摄像头跟随优先，暂停状态保持暂停。在等待回复期间发生的新手动操作会使该回复的动作过期，但仍显示文字。AI 动作完成后回到已有音乐/待机策略。

当前身体与表情可同时播放，尚未实现一句话中多个动作的时间轴。朗读时使用简单张嘴动画，与开始/结束同步，不是音素级唇形。摄像头跟随和暂停优先于朗读嘴形。

## Key、聊天记录与模型

- Key 通过 Electron **异步 safeStorage** 使用系统密钥服务加密，存入用户目录的 `ai-settings.json`。加密不可用时保存失败，不回退明文。
- 聊天记录保存在同目录 `ai-history.json`，是本地普通 JSON 文本，最多 80 条消息。界面可以清空；重启恢复最近记录。
- 配置沿用现有 `LanluoDesktop-v1.1` 用户目录。macOS 通常在 `~/Library/Application Support/LanluoDesktop-v1.1`，Windows 在系统 AppData 下相应目录。
- 每次发送将角色指令、最近 20 条历史消息（10 轮）和当前消息发送到 `https://api.deepseek.com/chat/completions`。不发送摄像头、模型文件、系统声音或麦克风音频。
- 端点固定为 DeepSeek 官方域名，禁止重定向。Key 不进入人物状态 SSE、日志、聊天记录或浏览器存储。
- 默认模型 `deepseek-flash`，可选 `deepseek-v4-pro`；关闭 thinking，采用 JSON Output，回复上限 650 tokens，45 秒请求超时。2026-11-12 查阅官方 API 文档后选择这些模型名。
- 同时只允许一个请求。JSON 模式返回空白、截断或不可解析内容时，最多追加一次纯文字请求，兜底回复不执行动作；这次补充请求也会使用账户额度。鉴权、余额、限流、网络错误与服务端拒绝不会自动重试。取消会中止本地请求并丢弃迟到回复，但服务端已处理的内容仍可能计费。
- 系统朗读只选择系统标记为本地的中文声音。声音选择、音色克隆、在线 TTS、语音识别、实时打断对话留待后续版本。

## 主要文件

| 文件 | 职责 |
| --- | --- |
| `shell/chat-service.cjs` | 主进程对话、系统加密、记录、API 请求、取消、回复白名单 |
| `shell/main.cjs` / `shell/preload.cjs` | 聊天窗口、受限 IPC、广播、私有动作接口 |
| `backend/web/chat.html` / `chat.css` / `chat-ui.js` | 聊天与连接设置界面 |
| `backend/web/src/chat-pet.js` | 桌宠气泡、系统朗读、嘴形生命周期 |
| `backend/pet/controller.py` | AI 动作优先级、单次播放、过期反应处理 |
| `backend/app.py` | 主进程令牌保护的 `/api/ai-reaction` |

## 验证与构建

在 `packaging/` 下运行：

```sh
node --test tests/chat-service.test.cjs
python3 -m unittest discover -s tests -p 'test_*.py'
node tests/verify-chat.cjs
node tests/verify-actions.cjs
./node_modules/.bin/esbuild backend/web/src/main.js --bundle --minify --format=esm --outfile=backend/web/app.js
```

聊天集成测试使用隔离的 `test-data/chat-dev/profile-*` 配置、无效的测试 Key 和模拟 DeepSeek 响应；不请求真实付费 API。它验证真实 Electron 窗口、系统加密、重启、动作同步和错误交互。语音生命周期用模拟播放验证；真实声音列表来自操作系统，未以模拟播放代替实听验收。截图和结果保存在 `test-data/chat-dev/`。

正式打包仍使用现有 `build-packages.mjs`。发布前需按目标平台验收签名、系统密钥访问和语音；macOS 当前采用 ad-hoc 签名，更新后的系统钥匙串识别行为需实测。

参考：
- [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)
- [DeepSeek JSON Output](https://api-docs.deepseek.com/guides/json_mode/)
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
- [Web Speech 语音合成](https://developer.mozilla.org/en-US/docs/Web/API/Window/speechSynthesis)

## 下一步

先用真实 Key 验证角色语气与延迟；再独立接入语音识别，做按住说话、转写确认、发送、朗读的闭环。其后再考虑流式回复、句级动作编排、更多表情和用户可查看/删除的长期记忆。

## 2026-11-12 空白回复修复验证

使用用户授权的 Key 进行了 7 次真实 API 请求（仅使用测试对话，不读取原有聊天记录）。旧逻辑的第三轮得到 HTTP 200、`finish_reason=stop`，但 `content` 只有空格，复现了“回复格式不完整”。修复后 3 轮真实连续对话成功；另模拟一次 JSON 空返回，后续真实纯文字兜底请求成功。测试 Key 只在测试进程内存中使用，没有写入源码或报告。

修复包括：历史 assistant 回复重新序列化为协议 JSON、完整代码围栏兼容、空白/格式/截断错误最多一次纯文字兜底、兜底不执行动作、取消丢弃迟到回复。13 项聊天服务测试和 Electron 聊天界面回归通过。服务端故障或两次都返回空内容时仍会显示可重试提示，无法保证每次网络请求成功。

### 本次 macOS 聊天验证的限制

打包版在真实系统密钥存储步骤两次超过 30 秒，测试没有写出 Key 配置，因此未将“系统加密保存可用”标记为通过。随后只在测试进程中替换存储接口，完成聊天窗口、模拟回复、动作联动、取消、错误恢复、重启和清空记录验证；发布应用仍使用原来的系统加密实现，没有明文回退，也没有包含测试替身。

实际使用时如出现钥匙串授权提示，需要由使用者在系统界面处理；若保存一直无响应，关闭并重新打开应用后再检查系统钥匙串状态。当前未完成这一步的实机确认。Electron 官方文档说明，ad-hoc 签名或更新后签名变化可能导致钥匙串重新授权，但本次未读到系统弹窗，不能断定超时的唯一原因。参考 [Electron 代码签名与系统 API](https://www.electronjs.org/docs/latest/tutorial/code-signing)。
