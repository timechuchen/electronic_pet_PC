#!/usr/bin/env python3
"""Run with Python 3.9+; no pip dependencies or runtime internet required."""
import argparse
import json
import sys
import os
import mimetypes
import secrets
import struct
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

from pet.controller import Controller
from pet.presets import PresetStore
from pet.desktop import DesktopHost
from pet.actions import ActionStore
from pet.assets import AssetStore, MAX_FILE_SIZE

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
MATERIAL = ROOT / "Material"


class PetServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, data_dir=None, hosted=False):
        super().__init__(address, Handler)
        self.controller = Controller()
        self.token = secrets.token_urlsafe(24)
        self.native_token = secrets.token_urlsafe(32)
        self.data_dir = Path(data_dir) if data_dir else ROOT / 'data'
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.assets = AssetStore(self.data_dir / 'assets')
        self.controller.set_fbx_actions(self.assets.snapshot()['motions'])
        self.actions = ActionStore(self.data_dir / 'actions.json')
        self.controller.set_custom_actions(self.actions.snapshot()['actions'])
        self.presets = PresetStore(self.data_dir / 'presets.json')
        self.controller.apply_profile(self.presets.selected())
        self.desktop = DesktopHost(ROOT, self.server_port, self.native_token, external=hosted)


    def state(self):
        if self.desktop.process is not None and not self.desktop.snapshot()['running'] and self.controller.music.enabled:
            with self.controller.lock:
                self.controller.music.enable(False)
                self.controller.music.message = '桌宠已退出，音频监听已停止'
        with self.assets.lock:
            state = self.controller.snapshot()
            state['asset_revision'] = self.assets.document['revision']
            state['model_id'] = self.assets.document['selected']
            return state


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
                "name": "兰洛", "model": self.server.assets.selected_model(),
                "model_id": self.server.assets.snapshot()["selected"],
                "dance": "/assets/Hip Hop Dancing.fbx", "token": self.server.token,
                "features": {"presets": True, "desktop": self.server.desktop.snapshot()["supported"]},
            })
            return
        if path == '/api/presets':
            self.reply(200, self.server.presets.snapshot())
            return
        if path == '/api/library':
            self.reply(200, self.server.assets.snapshot())
            return
        if path == '/api/actions':
            self.reply(200, self.server.actions.snapshot())
            return
        if path == '/api/native':
            if self.headers.get('X-Pet-Token') != self.server.native_token:
                self.reply(403, {'error': 'native access denied'})
                return
            self.reply(200, {'audio_requested': self.server.controller.music.enabled, 'show': self.server.desktop.show,
                             'interaction_revision': self.server.controller.interaction_revision})
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
        if path.startswith('/user-assets/'):
            target = self.server.assets.resolve(path[len('/user-assets/'):])
            if target is None:
                self.reply(404, {'error': '素材不存在'})
                return
        elif path.startswith("/assets/"):
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
        if path not in ('/api/command', '/api/presets', '/api/actions', '/api/desktop', '/api/music', '/api/audio', '/api/tracking', '/api/ai-reaction', '/api/library', '/api/library/upload'):
            self.reply(404, {"error": "接口不存在"})
            return
        expected_token = self.server.native_token if path in ('/api/audio', '/api/ai-reaction') else self.server.token
        if self.headers.get("X-Pet-Token") != expected_token:
            self.reply(403, {"error": "请刷新本地界面后重试"})
            return
        try:
            if path == '/api/library/upload':
                length = int(self.headers.get('Content-Length', '0'))
                if not 4 < length <= MAX_FILE_SIZE + 65540:
                    raise ValueError('素材上传大小无效，单文件最大 128 MB')
                prefix = self.rfile.read(4)
                if len(prefix) != 4:
                    raise ValueError('上传中断')
                metadata_size = struct.unpack('<I', prefix)[0]
                if not 0 < metadata_size <= 65536 or metadata_size >= length - 4:
                    raise ValueError('素材信息大小无效')
                metadata = json.loads(self.rfile.read(metadata_size))
                raw = self.rfile.read(length - 4 - metadata_size)
                if len(raw) != length - 4 - metadata_size:
                    raise ValueError('素材上传不完整，请重试')
                with self.server.assets.lock:
                    document = self.server.assets.import_file(metadata, raw)
                    self.server.controller.set_fbx_actions(document['motions'])
                self.reply(200, document)
                return
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= (1048576 if path == '/api/actions' else 65536 if path == "/api/presets" else 16384 if path == "/api/tracking" else 4096):
                raise ValueError("请求大小无效")
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError("命令必须为对象")
            if path == '/api/library':
                with self.server.assets.lock:
                    before = self.server.assets.document['selected']
                    document = self.server.assets.update(data)
                    self.server.controller.set_fbx_actions(document['motions'])
                    if before != document['selected']:
                        self.server.controller.command({'type': 'reset'})
                self.reply(200, document)
            elif path == '/api/ai-reaction':
                self.reply(200, self.server.controller.ai_reaction(data))
            elif path == '/api/actions':
                with self.server.actions.lock:
                    document = self.server.actions.update(data)
                    self.server.controller.set_custom_actions(document['actions'])
                self.reply(200, document)
            elif path == '/api/presets':
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
    parser.add_argument("--hosted", action="store_true", help="由独立应用管理窗口")
    parser.add_argument("--data-dir", help="可写用户配置目录")
    parser.add_argument("--port", type=int, default=8765, help="本地端口，默认 8765；0 自动选择")
    parser.add_argument("--desktop", action="store_true", help="启动独立桌宠，不打开浏览器")
    parser.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
    args = parser.parse_args()
    for path in (WEB / "app.js", MATERIAL / "兰洛.vrm"):
        if not path.is_file():
            parser.exit(1, "缺少必要文件：" + str(path) + "\n")
    try:
        server = PetServer(("127.0.0.1", args.port), data_dir=args.data_dir, hosted=args.hosted)
    except ValueError as exc:
        parser.exit(1, f"预设文件格式错误：{exc}\n请检查 data/presets.json，可参照 presets.example.json。\n")
    except OSError as exc:
        parser.exit(1, f"无法启动：{exc}\n可以尝试 python3 app.py --port 8766\n")
    url = f"http://127.0.0.1:{server.server_port}"
    if args.hosted:
        print('LANLUO_READY ' + json.dumps({'url': url, 'nativeToken': server.native_token}), flush=True)
        def watch_host():
            sys.stdin.buffer.read()
            server.shutdown()
        threading.Thread(target=watch_host, daemon=True).start()
    else:
        print(f"\n兰洛已启动：{url}\n按 Ctrl+C 退出。\n", flush=True)
    if args.desktop:
        server.desktop.launch()
    if not args.hosted and not args.no_browser and not args.desktop:
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
