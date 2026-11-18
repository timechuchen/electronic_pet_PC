# 舞姿预览（开发工具）

在浏览器里直接查看 `pet/choreography.py` 的采样结果，不启动完整桌宠，方便改动作时快速看姿态。

## 使用

在项目根目录开一个静态服务（需要能访问 `Material/兰洛.vrm`）：

```bash
cd project
python3 -m http.server 8777
```

然后打开：

```text
http://127.0.0.1:8777/tools/poser/index.html?data=/tools/poser/dance.json&play=1&clean=1
```

- `play=1`：循环播放。
- `clean=1`：隐藏时间标签，适合录屏。
- `t=9.6`：停在指定秒数；不传 `play` 时显示该帧。
- 在浏览器控制台可用 `poser.applyTime(秒)` 手动定位，`poser.setView({azimuth:0.55})` 切换三视角。

## 重新生成数据

改完 `pet/choreography.py` 后：

```bash
python3 tools/export_dance.py
```

会写出 `tools/poser/dance.json`（30 fps 采样）。预览页只读取这个 JSON，不会调用 Python 服务。

## 重新构建预览页

只改了 `poser.js` 或 `index.html` 时需要重新打包：

```bash
cd project
./node_modules/.bin/esbuild tools/poser/poser.js --bundle --format=esm --outfile=tools/poser/app.js
```
