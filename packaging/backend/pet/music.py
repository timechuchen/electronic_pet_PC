"""Debounce classifier confidence, silence and stopped/failed capture streams."""
import math


class MusicGate:
    def __init__(self, clock):
        self.clock = clock
        self.enabled = False
        self.active = False
        self.score = 0.0
        self.level = 0.0
        self.status = 'off'
        self.message = '音乐跟随已关闭'
        self.last_sample = -100.0
        self.candidate = None
        self.quiet_since = None
        self.started = 0.0
        self.epoch = 0

    def enable(self, enabled):
        self.enabled = enabled
        self.active = False
        self.candidate = self.quiet_since = None
        self.score = self.level = 0.0
        self.status = 'starting' if enabled else 'off'
        self.message = '等待系统音频授权与识别…' if enabled else '音乐跟随已关闭'

    def feed(self, data, profile):
        status = data.get('status', 'listening')
        if status not in ('starting', 'listening', 'error', 'off'):
            raise ValueError('无效音频状态')
        score, level = data.get('score', 0), data.get('level', 0)
        for number in (score, level):
            if isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number) or not 0 <= number <= 1:
                raise ValueError('音频评分必须在 0–1 之间')
        if not self.enabled:
            return
        now = self.clock()
        self.score, self.level = score, level
        self.status = status
        self.message = str(data.get('message', '正在识别系统音频'))[:240]
        if status in ('error', 'off'):
            self.enable(False)
            self.status = status
            self.message = str(data.get('message', '系统音频已停止'))[:240]
            return
        if status != 'listening':
            return
        # A gap cannot count as continuous music evidence.
        if now - self.last_sample > 2.5:
            self.candidate = None
        self.last_sample = now
        musical = score >= profile['music_threshold'] and level >= .001
        if musical:
            self.quiet_since = None
            if self.candidate is None:
                self.candidate = now
            if not self.active and now - self.candidate >= profile['music_start_seconds']:
                self.active = True
                self.started = now
                self.epoch += 1
        else:
            self.candidate = None
            if self.quiet_since is None:
                self.quiet_since = now
            if now - self.quiet_since >= profile['music_stop_seconds']:
                self.active = False

    def snapshot(self):
        if self.enabled and self.status == 'listening' and self.clock() - self.last_sample > 3:
            self.active = False
            self.candidate = None
            self.message = '暂未收到音频，等待音频恢复'
        return {'enabled': self.enabled, 'active': self.active, 'score': self.score, 'level': self.level,
                'status': self.status, 'message': self.message}
