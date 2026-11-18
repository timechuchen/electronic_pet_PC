# 兰洛 · Python 互动人物

使用 `Material/兰洛.vrm` 的真实三维模型，点击按钮控制人物。Python 负责动作时间线、骨骼角度、表情权重和控制接口；浏览器中的 Three.js / three-vrm 负责显示 VRM。不是视频播放，也不是静态图片切换。

## 启动

需要 **Python 3.9 或更高版本**，以及支持 WebGL 的 Chrome、Edge 或 Safari。

```bash
cd project
python3 app.py
```

也可以双击项目根目录的 **启动兰洛.command**（macOS）。浏览器会自动打开 `http://127.0.0.1:8765`，终端按 `Ctrl+C` 关闭服务。Windows 可在本目录运行 `python app.py`。

**日常使用无需 pip 安装、Node.js 或联网。** 已附带打包好的 `web/app.js`，所有模型和渲染依赖从本机加载。端口被占用时运行 `python3 app.py --port 8766`；只启动服务则加 `--no-browser`。

## 操作

| 按钮 / 快捷键 | 效果 |
|---|---|
| 挥挥手 / 1 | 抬起右手，连续挥动后放下 |
| 眨眨眼 / 2 | 双眼闭合后睁开 |
| 单眼眨眼 / 3 | 单眼闭合后睁开 |
| 微笑 / 4 | 模型自带 Joy 表情 |
| 点点头 / 5 | 点头回应 |
| 摇摇头 / 6 | 左右摇头 |
| 街舞 / 7 | 播放素材里的 Hip Hop Dancing.fbx（约 4.47 秒） |
| 跳一下 / 8 | 蹲下、跃起、轻轻落地 |
| 轻舞 / 9 | 播放原创优雅舞蹈（24 秒，程序生成，可循环） |
| 暂停 / 空格 | 冻结或继续动作、表情和自然待机 |
| 恢复待机 / Esc | 清除身体和表情动作，回到待机 |

身体动作与表情可以叠加，比如挥手时微笑、轻舞时眨眼。轻舞会自带一层很淡的笑意。同一通道的新动作会替换旧动作；再次点击会从头播放。开启“循环当前动作”后，身体和表情通道都会重复播放，直到切换动作或复位。复位保留速度、循环等设置。

支持 0.25×–2× 速度、自然眨眼开关、待机呼吸开关。鼠标拖动旋转，滚轮缩放；“全身 / 特写 / 回正”控制相机。系统开启“减少动态效果”时，默认关闭自然眨眼与呼吸，手动动作仍可播放。

所有打开的本地页面共享同一个 Python 人物状态。仅监听本机 `127.0.0.1`，不会上传素材。服务断开时动作按钮禁用，页面会尝试重连。

## 独立桌宠（macOS）

双击项目根目录的 **启动桌宠.command**，或在项目目录运行：

```bash
python3 desktop.py
```

也可以在网页点击 **打开独立桌宠**。已有 Python 服务时复用，没有则自动启动；人物显示在独立的 macOS 原生透明窗口中，无需保持浏览器打开。窗口使用系统 WebKit 进行 3D 渲染，Python 提供动作状态。当前附带的是 Apple Silicon 版本，桌宠与系统音频功能需要 macOS 13+。

鼠标移到人物窗口上方会出现工具条：**拖动、设置、置顶、穿透、退出**。拖动按钮可以移动位置。开启鼠标穿透后，在菜单栏找到 **“兰” → 鼠标穿透** 取消勾选即可恢复；菜单栏也能显示人物、打开控制面板、退出桌宠。退出桌宠会停止系统音频监听；Python 控制服务可继续运行，终端 Ctrl+C 完全关闭。若由桌宠启动器新建服务，需保留服务终端。

控制面板和桌宠共享动作、预设、音乐状态。摄像头在控制面板开启后，转换后的骨骼姿态会通过本机服务同步到桌宠；原始画面不上传或录制。控制面板关闭/进入后台时会停止摄像头，桌宠恢复待机。桌宠本身不会擅自请求摄像头。

原生源码在 `native/Lanluo.swift`，编译器为系统 Swift，无需安装 Python GUI 包。修改后重新编译：

```bash
python3 native/build.py
```

需要 Xcode Command Line Tools。脚本按本机 CPU 架构编译并做本地 ad-hoc 签名；不是经过 Apple 公证的发布包，换机器分发时需重新编译或正式签名。`native/兰洛桌宠.app` 是由启动器管理的组件，请使用上面的启动入口，确保 Python 服务及本地鉴权都已就绪。

## 动作预设：JSON

页面展开 **动作预设**，选择待机动作、默认表情、速度、自然眨眼和听到音乐时的动作，点击 **保存并应用**；也可另存为新预设、导出或导入。预设保存在 `data/presets.json`，重启自动恢复。示例格式见 `presets.example.json`。

推荐：**JSON 管理预设和触发规则，FBX 保存街舞素材，轻舞由代码生成**。JSON 不承载逐帧骨骼数据；后续要交换标准 VRM 动画，可以扩展 VRMA。轻舞是一支 24 秒的原创慢板，由 `pet/choreography.py` 实时采样，不依赖额外素材；不会因为 JSON 引用了一个新文件就自动导入它。

```json
{
  "id": "my_idle",
  "name": "我的陪伴模式",
  "idle_action": "sway",
  "expression": "smile",
  "speed": 1.0,
  "auto_blink": true,
  "music_action": "dance",
  "music_threshold": 0.65,
  "music_start_seconds": 1.5,
  "music_stop_seconds": 3.0
}
```

导入文件需要完整外层结构：`{"version":1,"selected":"my_idle","presets":[上面的预设对象]}`。动作可选 `breath`、`sway`、`look_around`、`wave`、`nod`、`shake`、`dance`、`grace`、`jump`；默认表情为 `neutral` 或 `smile`。音乐触发动作可选 `dance`、`grace`、`sway`、`wave`、`jump`。预设格式严格校验后原子写入，失败不会覆盖现有文件。

优先级：**摄像头实时姿态 > 手动身体动作 > 音乐触发动作 > 默认待机**。手动动作结束后恢复自动动作。恢复待机按钮会清除手动动作，并给自动动作留出约 2 个播放秒的过渡间隔；如果仍在播放音乐，会再次响应。音乐模式需单独停止。

## 动作库 JSON（轻舞）

设置页的“添加新动作”可以导入 `version=1` 的动作 JSON。本次轻舞的导入版位于 [releases/轻舞-动作.json](../../releases/轻舞-动作.json)，`id` 为 `custom_grace`，24 秒、120 帧，导入后会出现在“添加新动作”列表，点击即可播放，重启后仍保留。

- 格式是**相对站姿的角度偏移（度）**，首尾帧回到站姿；由 `tools/export_grace_action.py` 从 `pet/choreography.py` 采样生成。
- 动作库版使用 120 帧 + smoothstep 插值；内置的 9 号“轻舞”使用连续 Hermite、手腕跟随和自动微笑，更细腻。两者的动作路线一致。
- `project/tools/poser/dance.json` 是预览工具使用的绝对角度采样，不是动作库格式，不能导入。

重新生成：

```bash
cd packaging/backend
python3 tools/export_grace_action.py
```

## 系统音乐自动跳舞（macOS）

点击 **开启音乐跟随**，会启动桌宠组件。第一次由 macOS 请求屏幕/系统音频捕捉权限，请按系统提示允许“兰洛桌宠”；如被拒绝，在 **系统设置 → 隐私与安全性 → 屏幕与系统音频录制** 中开启，再重新点击。此系统权限名称可能包含“屏幕”，实现只注册音频输出，不读取、保存或录制屏幕画面，也不使用麦克风。

原生组件通过 [ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit) 获取系统音频，使用 [SoundAnalysis 内置分类器](https://developer.apple.com/documentation/soundanalysis/snclassifysoundrequest) 判定音乐，而不是只看音量。默认音乐置信度至少 0.65、持续确认 1.5 秒后跳舞；连续 3 秒低置信度/安静则回到待机。分类器本身还需要约 1.5 秒音频窗口，所以响应不是瞬时的。短暂通知音通常不会触发，但背景音乐、游戏和带配乐的视频都可能被判为音乐；阈值可调整。

只向 Python 发送音乐置信度和音量摘要，不保存或上传原始音频。音乐监听默认关闭，不随重启自动开启。关闭浏览器不会停止已主动开启的系统音频监听；点击停止音乐跟随、退出桌宠或关闭 Python 服务才会停止。受保护的内容或系统限制可能无法捕捉。当前为检测音乐后循环播放动作，尚未实现逐拍对齐或 BPM 驱动。

验证记录：原生透明窗口、置顶、真实 WebGL 加载通过；音乐分类器对本地生成的旋律样本的最高音乐置信度约 0.94。系统音频捕捉需要你本人授权，未将离线分类测试当作真人系统音频权限流程已通过。

## 摄像头实时模仿

刷新页面，点击顶部 **开启摄像头跟随**，在浏览器弹窗中允许摄像头。优先使用最新版 Chrome / Edge；如果 Codex 内置预览无法申请权限，请把本地地址复制到 Chrome 打开。不会自动开启摄像头，也不申请麦克风。

- 默认跟随上半身：双臂、身体倾斜、头部转动，另有眨眼、微笑和张嘴表情。
- **镜像跟随** 默认开启，像照镜子；关闭后按人物的左右手对应。
- **跟随腿部** 需要从头到脚完整入镜。默认关闭，坐在桌前也可以使用上半身模式。
- **正面校准**：面朝镜头、身体摆正后点击，以当前身体和头部姿态为中立位置；首次检测到脸时也会自动设置头部基准。
- 切换摄像头：首次授权后，停止跟随，再从摄像头下拉框选择其他设备，重新开启。
- **停止跟随**、**恢复待机**、`Esc`、切换到其他标签页或关闭页面，都会释放摄像头。模型加载失败、摄像头断开也会停止。再次使用需手动开启。

跟随模式会禁用预设动作、暂停、速度和循环等按钮；实时模仿不受动作速度影响。停止后恢复原有控制。姿态推理在浏览器 Worker 中完成，画面和原始识别关键点不发送到外网，不录制、不保存；只将转换后的骨骼旋转与表情权重临时传到本机 Python，以同步桌宠，停止或超过 1.2 秒未更新即失效。所有识别模型和 WASM 已附在 `web/tracking/`，首次启动需加载约 20 MB 的本地文件，之后无需联网。

这是单摄像头估计，不是专业动作捕捉：遮挡、背身、快速运动或弱光会降低准确度；不包含精细手指动作、脚底锁定或人物在场景内行走位移。请保持肩膀和双手可见；腿部不完整时保持上半身模式。丢失识别后人物回到基础姿态。脸部跟随受当前 VRM 自带表情形状限制。

实现采用 [MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js) 与 [Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js)。摄像头采集由当前页面管理，转换后的姿态可同步到同一服务的桌宠；Python 负责项目启动、动作仲裁和短时姿态同步。模型下载地址和 SHA-256 记录在 `web/tracking/assets.json`。

## 项目结构

```text
app.py                  Python 本地服务、静态资源、SSE 状态推送
pet/controller.py       动作定义、时间线、优先级、骨骼/表情计算
pet/presets.py          JSON 预设校验与持久化
pet/music.py            音乐置信度、防抖与恢复待机
pet/tracking.py         短时本机姿态同步
pet/desktop.py          原生桌宠进程管理
desktop.py              独立桌宠启动器
native/Lanluo.swift     macOS 窗口、系统音频与音乐分类
presets.example.json   可导入的预设格式示例
web/index.html          中文控制面板
web/style.css           界面样式
web/src/main.js         VRM 渲染、UI、相机、Python 状态接收
web/src/retarget.js     Mixamo FBX → VRM 骨骼重定向
web/src/capture.js      摄像头生命周期与限频调度
web/src/tracking-worker.js  本地姿态与表情推理
web/src/pose-rig.js     关键点 → VRM 姿态、镜像、校准
web/tracking/          识别模型、WASM、来源和许可
web/app.js              已打包渲染代码（运行时直接使用）
Material/               原始素材，保持原文件不变
screenshots/            实际渲染的效果截图
tests/                 Python 单元测试、Chrome 集成测试
```

挥手、点头、摇头是 Python 程序生成的骨骼动作；眨眼、单眼眨眼、微笑使用 VRM 内已有的 morph 表情。舞蹈使用原始 FBX 的关键帧，按 Python 时间线采样。映射遵循提供的 CSV 中 `Spine2 → chest` 的关系，补充为 VRM 标准骨骼名。本模型是 VRM 0.x，程序中的左右臂旋转方向已按该模型校准，替换其他模型时需检查。

原 MP4 保留为参考素材，不参与实时动作。原始模型的使用许可仍以素材自带的授权为准；本项目未更改或重新授权素材。

## 修改与测试

只修改 Python 动作时无需重新打包，重启 `app.py` 即可。修改 `web/src` 后需要 Node.js 20+：

```bash
npm ci
npm run build
```

Python 测试（不需要服务）：

```bash
python3 -m unittest discover -s tests -v
```

界面测试（先启动 `python3 app.py --no-browser`，本机安装 Chrome）：

```bash
npm run test:ui
```

测试验证实际 VRM 加载、七种动作、表情叠加、暂停/复位、速度/循环、键盘操作、窄屏布局及运行时无外部网络请求。截图输出到 `screenshots/`。

摄像头和骨骼映射测试：

```bash
npm run test:rig
npm run test:camera
```

`test:camera` 以官方测试图片创建模拟视频流，运行真正的 MediaPipe WASM 推理，验证身体/表情识别、腿部模式、手动启用、权限拒绝、取消授权、模型失败、资源释放和离线请求。不会打开真实摄像头。实机真人跟随效果需要在你的摄像头与光照条件下体验；测试通过不代表已验证所有摄像头设备。`tests/fixtures/` 的两张图片仅用于测试，来源见同目录的说明。

新增动作：在 `pet/controller.py` 的 `ACTIONS` 中增加名称、时长、通道，在 `snapshot()` 中计算骨骼弧度或表情权重，再添加对应界面按钮和名称。

参考：[three-vrm 官方骨骼接口](https://pixiv.github.io/three-vrm/docs/classes/three-vrm-core.VRMHumanoid.html)、[官方 Mixamo 动画示例](https://github.com/pixiv/three-vrm/blob/dev/packages/three-vrm/examples/humanoidAnimation/loadMixamoAnimation.js)、[Three.js FBXLoader](https://threejs.org/docs/pages/FBXLoader.html)。第三方许可见 `THIRD_PARTY_LICENSES.txt`。

桌宠及预设测试（共享一个 Python 服务，按顺序运行，勿并发修改人物状态）：

```bash
node tests/presets-ui.mjs
node tests/desktop-ui.mjs
"native/兰洛桌宠.app/Contents/MacOS/Lanluo" --self-test-audio
python3 tools/synth_music_fixture.py
"native/兰洛桌宠.app/Contents/MacOS/Lanluo" --classify-file /tmp/lanluo-music-test.wav
```
