# 兰洛桌宠 · PC

在 Mac 和 Windows 桌面上运行的三维电子宠物。支持触摸互动、动作与表情、VRM/FBX 导入、AI 文字聊天和中文朗读；连接兼容的 ESP32-S3 开发板后，可同步画面、触摸动作与语音。

## 下载 v1.3.0

| 平台 | 下载 | 使用方式 |
| --- | --- | --- |
| Mac Apple Silicon · macOS 13+ | [Mac 应用 ZIP](https://github.com/timechuchen/electronic_pet_PC/releases/download/v1.3.0/Lanluo-Desktop-1.3.0-macOS-AppleSilicon.zip) | 解压后打开 `兰洛桌宠.app`，可拖入“应用程序” |
| Windows 10/11 x64 | [Windows 应用 ZIP](https://github.com/timechuchen/electronic_pet_PC/releases/download/v1.3.0/Lanluo-Desktop-1.3.0-Windows-x64.zip) | 完整解压后运行 `Lanluo-1.3.0-Windows/Lanluo.exe`，保留同目录资源与 DLL |

[全部发布附件](https://github.com/timechuchen/electronic_pet_PC/releases/tag/v1.3.0) · [SHA-256 校验](https://github.com/timechuchen/electronic_pet_PC/releases/download/v1.3.0/SHA256SUMS.txt) · [使用说明](docs/v1.3.0/使用说明.md) · [AI 配置](docs/v1.3.0/AI接入说明.md) · [模型与 FBX](docs/v1.3.0/模型与FBX导入说明.md)

两个包均内置 Electron、Python 和串口依赖，无需另装 Node.js、Python 或 ffmpeg。仓库目前为私有，下载需要有仓库访问权限。Mac 包为 ad-hoc 签名、未做 Apple 公证；Windows 包未做发布者签名。

## 本版新增

- **USB 自动连接与重连**：启动后寻找目标开发板，菜单显示连接状态；可暂停连接以释放串口。
- **小屏陪伴**：发送角色画面和聊天气泡，接收开发板触摸动作。
- **板端语音**：连接时优先从开发板扬声器播放；未连接时使用电脑本地声音。
- **Mac 菜单栏图标**：已调整为 18×18 点，支持 Retina 和系统深浅色。

未连接开发板时，桌宠可独立使用。AI 聊天需要自行配置 DeepSeek Key；运行数据保存在本机用户目录，发布包不包含个人 Key、聊天记录或导入素材。

## 连接开发板

1. 给 **Waveshare ESP32-S3-Touch-AMOLED-1.75C** 烧录兼容兰洛固件。源码和编译步骤见 [ESP32 项目](https://github.com/timechuchen/electronic_pet_ESP32_S3)。当前不提供预编译烧录包。
2. 退出旧桌宠、旧 ESP32 服务端和串口监视器，使用 USB 数据线连接开发板。
3. 打开 v1.3.0，等待菜单出现“开发板已连接”。可使用“查看开发板预览”和“测试开发板语音”检查。

原生 USB 识别为 `303A:1001`。连接多块匹配设备时，请只保留一块目标板。已安装此前兰洛中文固件的开发板，无需为此次 PC 升级重新烧录。

## 从源码启动与构建

`packaging/` 是当前独立桌宠应用源码；`project/` 保留最初的 Python/Web 原型。Mac 开发运行需要 Python 3.10+、Node.js 22.12+ 和 npm：

```bash
git clone https://github.com/timechuchen/electronic_pet_PC.git
cd electronic_pet_PC/packaging
npm ci
python3 -m venv python
cd ..
./启动AI桌宠.command
```

前端资源已随源码提供。可选的 Mac 系统音乐跟随组件需要 Xcode Command Line Tools，再执行 `python3 packaging/backend/native/build.py`。构建独立应用还需要准备两平台 Python 运行时，步骤见 [构建说明](packaging/README.md)。

```text
packaging/shell/          Electron 桌宠、AI 聊天和 USB 桥接
packaging/backend/        本地服务、角色渲染、模型与动作
packaging/board_runtime/  跨平台串口协议和 pySerial
packaging/tests/          单元与集成检查
project/                 原型工程
docs/v1.3.0/             发布使用说明及验证记录
```

依赖目录、运行时、用户资料、构建缓存、测试数据、历史备份和安装包不进入 Git；安装包通过 Releases 分发。

## 验证与限制

- 19 项 Node 测试、26 项 Python 测试通过。
- Mac 已验证应用启动、开发板画面与语音传输、动作回传、暂停/恢复和 USB 工作进程中断后的重连。联机约 10 帧/秒；菜单栏图标更新后另行检查了尺寸、Retina 图层和签名。
- Windows 在 Mac 上交叉构建，完成包内容、版本和 x64 可执行文件检查；Windows USB、中文 SAPI 和系统权限仍需实机验收。
- AI 回归使用模拟服务和模拟密钥存储。原 Mac 系统钥匙串超时问题尚未重新验收，不能将模拟测试视为真实 Key 保存通过。

详细结果见 [构建与验证记录](docs/v1.3.0/构建与验证记录.json)。

## 代码与素材

第三方代码、模型、动作和字体保留原有授权范围。本仓库未额外授予角色素材公开再分发许可。

参见 [第三方组件说明](packaging/backend/THIRD_PARTY_LICENSES.txt) 和 [pySerial 许可证](packaging/board_runtime/pyserial-3.5.dist-info/LICENSE.txt)。
