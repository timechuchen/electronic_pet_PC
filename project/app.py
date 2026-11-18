#!/usr/bin/env python3
"""Run with Python 3.9+; no pip dependencies or runtime internet required."""
import argparse
import json
import mimetypes
import secrets
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

from pet.controller import Controller
from pet.presets import PresetStore
from pet.desktop import DesktopHost

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
MATERIAL = ROOT / "Material"


class PetServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address):
        super().__init__(address, Handler)
        self.controller = Controller()
        self.token = secrets.token_urlsafe(24)
        self.native_token = secrets.token_urlsafe(32)
        self.presets = PresetStore(ROOT / 'data/presets.json')
        self.controller.apply_profile(self.presets.selected())
        self.desktop = DesktopHost(ROOT, self.server_port, self.native_token)


    def state(self):
        if self.desktop.process is not None and not self.desktop.snapshot()['running'] and self.controller.music.enabled:
            with self.controller.lock:
                self.controller.music.enable(False)
                self.controller.music.message = '桌宠已退出，音频监听已停止'
        return self.controller.snapshot()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        if args and str(args[0]).startswith("POST"):
            return
        super().log_message(fmt, *args)

    def reply(self, status, data):
        raw = json.dumps(data, ensure_ascii=False, allow_nan=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        if path == "/api/config":
            self.reply(200, {
                "name": "兰洛", "model": "/assets/兰洛.vrm",
                "dance": "/assets/Hip Hop Dancing.fbx", "token": self.server.token,
                "features": {"presets": True, "desktop": self.server.desktop.snapshot()["supported"]},
            })
            return
        if path == '/api/presets':
            self.reply(200, self.server.presets.snapshot())
            return
        if path == '/api/native':
            if self.headers.get('X-Pet-Token') != self.server.native_token:
                self.reply(403, {'error': 'native access denied'})
                return
            self.reply(200, {'audio_requested': self.server.controller.music.enabled, 'show': self.server.desktop.show})
            return
        if path == '/api/desktop':
            self.reply(200, self.server.desktop.snapshot())
            return
        if path == "/api/state":
            self.reply(200, self.server.state())
            return
        if path == "/api/events":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            try:
                while True:
                    data = json.dumps(self.server.state(), separators=(",", ":"))
                    self.wfile.write(("data: " + data + "\n\n").encode())
                    self.wfile.flush()
                    time.sleep(1 / 30)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass
            return
        if path.startswith("/assets/"):
            # Expose only the two render assets, never arbitrary project files.
            name = path[len("/assets/"):]
            if name not in ("兰洛.vrm", "Hip Hop Dancing.fbx"):
                self.reply(404, {"error": "素材不存在"})
                return
            target = MATERIAL / name
        else:
            target = (WEB / (path.lstrip("/") or "index.html")).resolve()
            if WEB.resolve() not in target.parents:
                self.reply(403, {"error": "无权访问"})
                return
        if not target.is_file():
            self.reply(404, {"error": "文件不存在"})
            return
        self.send_response(200)
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(target.stat().st_size))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        try:
            with target.open("rb") as source:
                while True:
                    chunk = source.read(256 * 1024)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_POST(self):
        path = urlsplit(self.path).path
        if path not in ('/api/command', '/api/presets', '/api/desktop', '/api/music', '/api/audio', '/api/tracking'):
            self.reply(404, {"error": "接口不存在"})
            return
        expected_token = self.server.native_token if path == "/api/audio" else self.server.token
        if self.headers.get("X-Pet-Token") != expected_token:
            self.reply(403, {"error": "请刷新本地界面后重试"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= (65536 if path == "/api/presets" else 16384 if path == "/api/tracking" else 4096):
                raise ValueError("请求大小无效")
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError("命令必须为对象")
            if path == '/api/presets':
                with self.server.presets.lock:
                    document = self.server.presets.update(data)
                    self.server.controller.apply_profile(self.server.presets.selected())
                self.reply(200, document)
            elif path == '/api/desktop':
                self.reply(200, self.server.desktop.launch())
            elif path == '/api/music':
                enabled = data.get('enabled')
                if not isinstance(enabled, bool):
                    raise ValueError('enabled 必须为布尔值')
                if enabled:
                    self.server.desktop.launch()
                with self.server.controller.lock:
                    self.server.controller.music.enable(enabled)
                self.reply(200, self.server.state())
            elif path == '/api/tracking':
                with self.server.controller.lock:
                    self.server.controller.tracking.feed(data)
                self.reply(200, {'ok': True})
            elif path == '/api/audio':
                with self.server.controller.lock:
                    self.server.controller.music.feed(data, self.server.controller.profile)
                self.reply(200, {'ok': True})
            else:
                self.reply(200, self.server.controller.command(data))
        except (ValueError, TypeError, OSError) as exc:
            self.reply(400, {"error": str(exc)})


def main():
    parser = argparse.ArgumentParser(description="兰洛 · Python 互动人物")
    parser.add_argument("--port", type=int, default=8765, help="本地端口，默认 8765；0 自动选择")
    parser.add_argument("--desktop", action="store_true", help="启动独立桌宠，不打开浏览器")
    parser.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
    args = parser.parse_args()
    for path in (WEB / "app.js", MATERIAL / "兰洛.vrm"):
        if not path.is_file():
            parser.exit(1, "缺少必要文件：" + str(path) + "\n")
    try:
        server = PetServer(("127.0.0.1", args.port))
    except ValueError as exc:
        parser.exit(1, f"预设文件格式错误：{exc}\n请检查 data/presets.json，可参照 presets.example.json。\n")
    except OSError as exc:
        parser.exit(1, f"无法启动：{exc}\n可以尝试 python3 app.py --port 8766\n")
    url = f"http://127.0.0.1:{server.server_port}"
    print(f"\n兰洛已启动：{url}\n按 Ctrl+C 退出。\n", flush=True)
    if args.desktop:
        server.desktop.launch()
    if not args.no_browser and not args.desktop:
        threading.Timer(0.6, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已关闭兰洛。")
    finally:
        server.desktop.close()
        server.server_close()


if __name__ == "__main__":
    main()
