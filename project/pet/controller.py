"""Pure Python action timeline. Angles are radians in the VRM normalized rig."""
import math
import random
import threading
import time

from .presets import DEFAULT_PRESET
from .music import MusicGate
from .tracking import PoseRelay
from . import choreography


ACTIONS = {
    "wave": ("挥手", 3.0, "body"),
    "blink": ("眨眼", 0.38, "face"),
    "wink": ("单眼眨眼", 1.1, "face"),
    "smile": ("微笑", 2.8, "face"),
    "nod": ("点头", 2.0, "body"),
    "shake": ("摇头", 2.2, "body"),
    "dance": ("跳舞", 20.0, "body"),
    "grace": ("轻舞", 24.0, "body"),
}


def smooth(value):
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


def envelope(t, duration, fade=0.35):
    return smooth(t / fade) * smooth((duration - t) / fade)


class Controller:
    """One local character; facial actions can be layered on body actions."""

    def __init__(self, clock=time.monotonic):
        self.profile = dict(DEFAULT_PRESET)
        self.music = MusicGate(clock)
        self.tracking = PoseRelay(clock)
        self.dance_duration = 4.4666666984558105
        self.automatic_after = 0.0
        self.lock = threading.RLock()
        self.clock = clock
        self.last_tick = clock()
        self.elapsed = 0.0
        self.speed = 1.0
        self.loop = False
        self.paused = False
        self.auto_blink = True
        self.idle_motion = True
        self.channels = {"body": None, "face": None}
        self.serial = 0
        self.next_blink = 3.5
        self.auto_blink_start = -100.0

    def apply_profile(self, profile):
        with self.lock:
            self._tick()
            self.profile = dict(profile)
            self.speed = profile['speed']
            self.auto_blink = profile['auto_blink']
            self.channels = {"body": None, "face": None}

    def _tick(self):
        now = self.clock()
        dt = max(0.0, now - self.last_tick)
        self.last_tick = now
        if self.paused:
            return
        dt *= self.speed
        self.elapsed += dt
        for channel, action in self.channels.items():
            if action is None:
                continue
            action["time"] += dt
            if action["time"] >= action["duration"]:
                if self.loop:
                    action["time"] %= action["duration"]
                else:
                    self.channels[channel] = None
        if self.auto_blink and self.elapsed >= self.next_blink:
            self.auto_blink_start = self.elapsed
            self.next_blink = self.elapsed + random.uniform(3.0, 5.5)

    def command(self, data):
        with self.lock:
            # Validate everything before mutating state.
            kind = data.get("type")
            if kind == "action":
                name = data.get("name")
                if name not in ACTIONS:
                    raise ValueError("未知动作")
                duration = ACTIONS[name][1]
                if name == "dance":
                    duration = data.get("duration", duration)
                    if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not math.isfinite(duration) or not 0.1 <= duration <= 300:
                        raise ValueError("舞蹈时长必须在 0.1–300 秒之间")
            elif kind == "settings":
                for key, value in data.items():
                    if key == "type":
                        continue
                    if key == "speed":
                        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0.25 <= value <= 2:
                            raise ValueError("播放速度必须在 0.25–2 之间")
                    elif key in ("loop", "auto_blink", "idle_motion"):
                        if not isinstance(value, bool):
                            raise ValueError(key + " 必须为布尔值")
                    else:
                        raise ValueError("未知设置项")
            elif kind not in ("pause", "reset"):
                raise ValueError("未知命令")

            self._tick()
            if kind == "action":
                self.serial += 1
                self.channels[ACTIONS[name][2]] = {
                    "name": name, "time": 0.0, "duration": duration,
                    "id": self.serial,
                }
                self.paused = False
            elif kind == "settings":
                for key, value in data.items():
                    if key != "type":
                        setattr(self, key, value)
            elif kind == "pause":
                self.paused = not self.paused
            elif kind == "reset":
                self.channels = {"body": None, "face": None}
                self.paused = False
                self.auto_blink_start = -100.0
                self.next_blink = self.elapsed + 3.5
                self.automatic_after = self.elapsed + 2.0
            return self.snapshot()

    def snapshot(self):
        with self.lock:
            self._tick()
            t = self.elapsed
            breath = math.sin(t * 1.8) if self.idle_motion else 0.0
            bones = {
                "leftUpperArm": [0.0, 0.0, 1.22],
                "rightUpperArm": [0.0, 0.0, -1.22],
                "leftLowerArm": [0.0, -0.08, 0.08],
                "rightLowerArm": [0.0, 0.08, -0.08],
                "spine": [0.015 * breath, 0.0, 0.0],
                "head": [0.0, 0.025 * breath, 0.0],
            }
            face = {"blink": 0.0, "blinkLeft": 0.0, "happy": .35 if self.profile["expression"] == "smile" else 0.0}
            bt = t - self.auto_blink_start
            if self.auto_blink and 0 <= bt <= 0.32:
                face["blink"] = math.sin(math.pi * bt / 0.32) ** 2
            music = self.music.snapshot()
            body = self.channels["body"]
            automatic = None
            if body is None and self.elapsed >= self.automatic_after:
                automatic = self.profile['music_action'] if music['active'] else self.profile['idle_action']
                if automatic in ACTIONS:
                    duration = self.dance_duration if automatic == 'dance' else ACTIONS[automatic][1]
                    body = {'name': automatic, 'time': t % duration, 'duration': duration,
                            'id': -1, 'source': 'music' if music['active'] else 'idle'}
                elif automatic == 'sway':
                    bones['spine'][2] = math.sin(t * 1.8) * .055
                    bones['head'][2] = -math.sin(t * 1.8) * .035
                    bones['leftUpperArm'][2] += math.sin(t * 1.8) * .09
                    bones['rightUpperArm'][2] += math.sin(t * 1.8) * .09
                elif automatic == 'look_around':
                    bones['head'][1] = math.sin(t * .65) * .24
                    bones['head'][0] = math.sin(t * .9) * .06
            if body:
                at, duration = body["time"], body["duration"]
                blend = envelope(at, duration)
                if body["name"] == "wave":
                    bones["rightUpperArm"] = [-0.25 * blend, 0.0, -1.22 + 1.65 * blend]
                    bones["rightLowerArm"] = [0.0, 0.08, -0.08 + 1.45 * blend]
                    bones["rightHand"] = [0.0, 0.0, math.sin(at * 10) * 0.38 * blend]
                    bones["head"][2] = -0.08 * blend
                elif body["name"] == "nod":
                    bones["head"][0] = 0.24 * math.sin(at * 7.5) * blend
                elif body["name"] == "shake":
                    bones["head"][1] = 0.32 * math.sin(at * 8) * blend
                elif body["name"] == "grace":
                    bones.update(choreography.sample(at))
                    # 轻舞自带一层温柔的笑意；手动播放时随动作淡入淡出。
                    if body.get("source") or self.loop:
                        smile = 0.55
                    else:
                        smile = 0.55 * min(1.0, at / 0.9, (duration - at) / 0.9)
                    face["happy"] = max(face["happy"], smile)
            facial = self.channels["face"]
            if facial:
                ft, duration = facial["time"], facial["duration"]
                if facial["name"] == "blink":
                    face["blink"] = math.sin(math.pi * ft / duration) ** 2
                elif facial["name"] == "wink":
                    face["blink"] = 0.0
                    face["blinkLeft"] = envelope(ft, duration, 0.18)
                elif facial["name"] == "smile":
                    face["happy"] = envelope(ft, duration, 0.5)
            return {
                "time": t, "bones": bones, "expressions": face,
                "profile": self.profile, "music": music, "automatic": automatic,
                "tracking": self.tracking.snapshot(),
                "body": dict(body) if body else None,
                "face": dict(facial) if facial else None,
                "speed": self.speed, "loop": self.loop, "paused": self.paused,
                "auto_blink": self.auto_blink, "idle_motion": self.idle_motion,
            }
