"""Process lifecycle for the optional macOS desktop/audio companion."""
import platform
import subprocess
import threading
from pathlib import Path


class DesktopHost:
    def __init__(self, root, port, token, external=False):
        self.external = external
        self.root, self.port, self.token = Path(root), port, token
        self.process = None
        self.lock = threading.RLock()
        self.show = 0
        self.log = None

    def snapshot(self):
        return {'supported': self.external or platform.system() == 'Darwin',
                'running': self.external or (self.process is not None and self.process.poll() is None)}

    def launch(self):
        with self.lock:
            if self.external:
                self.show += 1
                return self.snapshot()
            if platform.system() != 'Darwin':
                raise ValueError('当前独立桌宠与系统音频组件适用于 macOS；网页功能仍然可用')
            self.show += 1
            if self.snapshot()['running']:
                return self.snapshot()
            binary = self.root / 'native/兰洛桌宠.app/Contents/MacOS/Lanluo'
            if not binary.is_file():
                raise ValueError('桌宠组件尚未编译，请在项目目录运行 python3 native/build.py')
            self.log = (self.root / 'data/desktop.log').open('a')
            self.process = subprocess.Popen([str(binary), '--url', f'http://127.0.0.1:{self.port}', '--native-token', self.token], stdout=self.log, stderr=self.log, cwd=self.root)
            return self.snapshot()

    def close(self):
        with self.lock:
            if self.process and self.process.poll() is None:
                self.process.terminate()
                try:
                    self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.process.kill()
            if self.log:
                self.log.close()
