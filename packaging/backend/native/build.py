#!/usr/bin/env python3
"""Build the macOS shell locally. No Python GUI packages or remote dependencies."""
import pathlib
import plistlib
import platform
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent
APP = ROOT / '兰洛桌宠.app'
BINARY = APP / 'Contents/MacOS/Lanluo'

def build():
    BINARY.parent.mkdir(parents=True, exist_ok=True)
    info = {'CFBundleExecutable': 'Lanluo', 'CFBundleIdentifier': 'local.lanluo.standalone.audio',
            'CFBundleName': '兰洛桌宠', 'CFBundleDisplayName': '兰洛桌宠',
            'CFBundlePackageType': 'APPL', 'CFBundleVersion': '1', 'CFBundleShortVersionString': '1.0',
            'LSMinimumSystemVersion': '13.0', 'LSUIElement': True,
            'NSAudioCaptureUsageDescription': '在本机识别正在播放的系统音乐，让兰洛自动跳舞；不保存或上传音频。',
            'NSScreenCaptureUsageDescription': '仅从系统捕捉音频以识别音乐，不读取、录制或保存屏幕画面。',
            'NSAppTransportSecurity': {'NSAllowsLocalNetworking': True}}
    (APP / 'Contents/Info.plist').write_bytes(plistlib.dumps(info))
    subprocess.run(['xcrun', 'swiftc', '-swift-version', '5', '-O', '-module-cache-path', str(ROOT / '.module-cache'),
                    '-target', ('arm64' if platform.machine() == 'arm64' else 'x86_64') + '-apple-macosx13.0', str(ROOT / 'Lanluo.swift'), '-o', str(BINARY),
                    '-framework', 'AppKit', '-framework', 'WebKit', '-framework', 'ScreenCaptureKit', '-framework', 'SoundAnalysis', '-framework', 'AVFoundation'], check=True)
    subprocess.run(['codesign', '--force', '--sign', '-', str(APP)], check=True)
    print(APP)

if __name__ == '__main__': build()
