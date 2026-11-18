# 独立桌宠源码与构建

当前版本 **v1.3.0**，支持 Mac Apple Silicon 和 Windows x64；USB 自动连接、角色画面、触摸回传和板端语音均在本工程实现。下载和用户说明见 [项目首页](../README.md)。`../project/` 是保留的原型工程。

## 开发启动

需要 Python 3.10+、Node.js 22.12+、npm。首次准备：

```sh
cd packaging
npm ci
python3 -m venv python
cd ..
./启动AI桌宠.command
```

串口依赖 pySerial 3.5 已随 `board_runtime/` 保存。开发版和打包版均使用 OS 用户目录 `LanluoDesktop-v1.1`；调试可用 `--test-data=/绝对路径` 隔离个人配置。macOS 使用系统 say/afconvert，Windows 使用 System.Speech 中文 SAPI；无须外部 ffmpeg。

修改渲染代码后：

```sh
cd packaging
./node_modules/.bin/esbuild backend/web/src/main.js --bundle --minify --format=esm --outfile=backend/web/app.js
npm run build:audio
```

## 准备独立应用运行时

构建输入不保存在 Git。按 [`runtime-checksums.json`](runtime-checksums.json) 中的 URL 下载并核对 SHA-256：

- Mac：解压 python-build-standalone，将 `python/` 放到 `runtimes/macos-arm64/python/`。
- Windows：解压 python.org embeddable ZIP 到 `runtimes/windows-x64/python/`，其中应直接包含 `python.exe`、`python313.zip` 和 `python313._pth`。

保持文件布局与符号链接。开发用的 `python` 虚拟环境与构建输入 `runtimes/` 用途不同。

Electron 45.3.0 压缩包可预先放到 `downloads/electron-zips/`，文件名为 `electron-v45.3.0-darwin-arm64.zip` 和 `electron-v45.3.0-win32-x64.zip`；缺失时打包器会联网下载。

## 构建

在 Mac 上构建两平台应用，Mac 原生音频助手需要 Xcode Command Line Tools：

```sh
cd packaging
python3 backend/native/build.py
node build-packages.mjs darwin
node build-packages.mjs win32
```

输出为 `build/Lanluo-darwin-arm64/Lanluo.app` 和 `build/Lanluo-win32-x64/`。构建脚本从 `shell/package.json` 读取版本，打包 backend、Python 和 USB 运行时，Mac 自动进行 ad-hoc 签名；不会自动进行 Apple 公证或 Windows 发布者签名。

本机历史发布目录 `../releases/` 被 Git 忽略，最新可下载文件见 [GitHub Releases](https://github.com/timechuchen/electronic_pet_PC/releases)。用户指南和验证记录同步保存在 [`../docs/v1.3.0/`](../docs/v1.3.0/)。

## 测试

```sh
cd packaging
node --test tests/chat-service.test.cjs tests/board.test.cjs
./python/bin/python3 -B -m unittest discover -s tests -p 'test_*.py'
node tests/verify-chat.cjs --packaged --mock-storage --no-board
node tests/verify-assets.cjs --packaged
node tests/verify-actions.cjs --packaged
node tests/verify-package.cjs
node tests/verify-distribution.cjs
```

独立桌宠基础检查可加 `--smoke-test --no-board --test-data=/绝对路径`；开发板实机检查使用 `--board-smoke --test-data=/绝对路径`。后者会发送画面、模拟动作/回复和测试语音，并测试 USB 工作进程退出后的恢复，不重烧固件、不调用付费 AI。

`verify-chat --mock-storage` 仅用于真实钥匙串阻塞时验证其他流程，不代表系统加密已通过。Windows 的 USB 和语音需要 Windows 实机验收。素材/动作等较早集成脚本按原桌宠窗口布局编写，运行前可断开开发板或在独立测试资料中关闭自动连接。

## 目录与实现

- `shell/`：Electron、受限 preload、聊天服务、USB 桥接及语音转换。
- `backend/`：Python 本地服务、三维资源、网页引擎和 Mac 音频助手源码。
- `board_runtime/`：串口协议与 pySerial，内含许可证。
- `tests/`：逻辑与应用验证脚本；输出到被忽略的 `test-data/`。

应用仅监听本机随机端口。摄像头权限仅用于设置窗口，系统音频仅用于内部音频窗口。开发板连接失败时保留桌宠功能；菜单可暂停自动连接、释放串口。退出应用会结束本机子进程。
