"""Pure Python action timeline. Angles are radians in the VRM normalized rig."""
import math
import random
import threading
import time

from .presets import DEFAULT_PRESET
from .music import MusicGate
from .tracking import PoseRelay
from .actions import JUMP, sample_action
from . import choreography


ACTIONS = {
    "wave": ("挥手", 3.0, "body"),
    "blink": ("眨眼", 0.38, "face"),
    "wink": ("单眼眨眼", 1.1, "face"),
    "smile": ("微笑", 2.8, "face"),
    "nod": ("点头", 2.0, "body"),
    "shake": ("摇头", 2.2, "body"),
    "dance": ("跳舞", 20.0, "body"),
    "jump": ("跳跃", JUMP['duration'], "body"),
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
        self.automatic_cycle = None
        self.automatic_origin = 0.0
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
        self.interaction_revision = 0
        self.fbx_actions = {}
        self.keyframe_actions = {'jump': JUMP}
        self.action_revision = 0
        self.next_blink = 3.5
        self.auto_blink_start = -100.0

    def set_custom_actions(self, actions):
        with self.lock:
            self._tick()
            self.keyframe_actions = {'jump': JUMP, **{a['id']: a for a in actions}}
            self.action_revision += 1
            if self.channels['body'] and self.channels['body']['name'].startswith('custom_'):
                self.channels['body'] = None

    def set_fbx_actions(self, actions):
        with self.lock:
            self._tick()
            self.fbx_actions = {a['id']: a for a in actions}
            body = self.channels['body']
            if body and body['name'].startswith('fbx_') and body['name'] not in self.fbx_actions:
                self.channels['body'] = None

    def action_info(self, name):
        if not isinstance(name, str):
            raise ValueError('动作名称必须是字符串')
        if name in ACTIONS:
            return ACTIONS[name]
        if name in self.fbx_actions:
            action = self.fbx_actions[name]
            return action.get('clipName') or action['name'], action['duration'], 'body'
        if name in self.keyframe_actions:
            action = self.keyframe_actions[name]
            return action['name'], action['duration'], 'body'
        raise ValueError('未知动作')

    def apply_profile(self, profile):
        with self.lock:
            self.interaction_revision += 1
            self._tick()
            self.profile = dict(profile)
            self.speed = profile['speed']
            self.auto_blink = profile['auto_blink']
            self.channels = {"body": None, "face": None}
            self.automatic_cycle = None

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
                if self.loop and action.get('source') != 'ai':
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
                label, duration, channel = self.action_info(name)
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
            self.interaction_revision += 1
            if kind == "action":
                self.serial += 1
                self.channels[channel] = {
                    "name": name, "time": 0.0, "duration": duration,
                    "id": self.serial, "label": label,
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
                self.automatic_cycle = None
                self.paused = False
                self.auto_blink_start = -100.0
                self.next_blink = self.elapsed + 3.5
                self.automatic_after = self.elapsed + 2.0
            return self.snapshot()

    def ai_reaction(self, data):
        """Short, one-shot reactions never override a newer user interaction."""
        action, expression, revision = data.get('action'), data.get('expression'), data.get('revision')
        if action not in ('none', 'wave', 'nod', 'shake', 'dance', 'jump') or expression not in ('neutral', 'smile', 'wink', 'blink') or type(revision) is not int:
            raise ValueError('AI 动作格式无效')
        with self.lock:
            self._tick()
            if revision != self.interaction_revision or self.paused or self.tracking.snapshot():
                return {'applied': False}
            applied = False
            for name, channel, empty in ((action, 'body', 'none'), (expression, 'face', 'neutral')):
                current = self.channels[channel]
                if current and current.get('source') != 'ai':
                    continue
                if name == empty:
                    self.channels[channel] = None
                    continue
                label, duration, _ = self.action_info(name)
                self.serial += 1
                self.channels[channel] = {'name': name, 'time': 0.0,
                    'duration': self.dance_duration if name == 'dance' else duration,
                    'id': self.serial, 'label': label, 'source': 'ai'}
                applied = True
            return {'applied': applied}

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
            root_y = 0.0
            if body is not None:
                self.automatic_cycle = None
            automatic = None
            if body is None and self.elapsed >= self.automatic_after:
                automatic = self.profile['music_action'] if music['active'] else self.profile['idle_action']
                if automatic not in ACTIONS:
                    self.automatic_cycle = None
                if automatic in ACTIONS:
                    duration = self.dance_duration if automatic == 'dance' else ACTIONS[automatic][1]
                    source = 'music' if music['active'] else 'idle'
                    cycle = (automatic, source)
                    if self.automatic_cycle != cycle:
                        self.automatic_cycle, self.automatic_origin = cycle, t
                    body = {'name': automatic, 'time': (t-self.automatic_origin) % duration, 'duration': duration,
                            'id': -1, 'label': ACTIONS[automatic][0], 'source': source}
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
                    if body.get("source") or self.loop:
                        smile = 0.55
                    else:
                        smile = 0.55 * min(1.0, at / 0.9, (duration - at) / 0.9)
                    face["happy"] = max(face["happy"], smile)
                elif body['name'] in self.keyframe_actions:
                    offsets, root_y = sample_action(self.keyframe_actions[body['name']], at)
                    for bone, rotation in offsets.items():
                        bones[bone] = [a+b for a,b in zip(bones.get(bone, [0,0,0]), rotation)]
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
                "time": t, "bones": bones, "expressions": face, "root_y": root_y,
                "action_revision": self.action_revision,
                "profile": self.profile, "music": music, "automatic": automatic,
                "tracking": self.tracking.snapshot(),
                "body": dict(body) if body else None,
                "face": dict(facial) if facial else None,
                "speed": self.speed, "loop": self.loop, "paused": self.paused,
                "auto_blink": self.auto_blink, "idle_motion": self.idle_motion,
            }
