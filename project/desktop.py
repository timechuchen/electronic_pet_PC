#!/usr/bin/env python3
"""Start a standalone desktop pet, reusing an existing compatible local server."""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description='启动兰洛独立桌宠')
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    base = f'http://127.0.0.1:{args.port}'
    try:
        with urllib.request.urlopen(base + '/api/config', timeout=2) as response:
            config = json.load(response)
    except (urllib.error.URLError, TimeoutError):
        os.execv(sys.executable, [sys.executable, str(Path(__file__).with_name('app.py')), '--desktop', '--port', str(args.port)])
        return
    if not config.get('features', {}).get('desktop'):
        parser.exit(1, '当前端口的服务不支持桌宠，请关闭旧服务后重新启动。\n')
    request = urllib.request.Request(base + '/api/desktop', data=b'{}', headers={'Content-Type': 'application/json', 'X-Pet-Token': config['token']})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            json.load(response)
        print('兰洛桌宠已打开。菜单栏“兰”可打开设置、恢复鼠标交互或退出。')
    except urllib.error.HTTPError as error:
        parser.exit(1, json.load(error).get('error', str(error)) + '\n')


if __name__ == '__main__': main()
