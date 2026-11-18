"""Data-only body animations: validated keyframes, interpolation and user storage."""
import copy
import json
import math
import os
import re
import threading
from pathlib import Path

BONES = frozenset(('hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
    'leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm',
    'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand',
    'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg',
    'leftFoot', 'rightFoot', 'leftToes', 'rightToes'))
MAX_ACTIONS = 32

JUMP = {'id': 'jump', 'name': '跳跃', 'duration': 1.8, 'keyframes': [
    {'time': 0, 'lift': 0, 'bones': {}},
    {'time': .30, 'lift': -.035, 'bones': {
        'leftUpperLeg': [-28, 0, 0], 'rightUpperLeg': [-28, 0, 0],
        'leftLowerLeg': [56, 0, 0], 'rightLowerLeg': [56, 0, 0],
        'leftFoot': [-28, 0, 0], 'rightFoot': [-28, 0, 0],
        'spine': [9, 0, 0], 'leftUpperArm': [18, 0, 0], 'rightUpperArm': [18, 0, 0]}},
    {'time': .50, 'lift': .025, 'bones': {
        'leftUpperArm': [-35, 0, -24], 'rightUpperArm': [-35, 0, 24]}},
    {'time': .80, 'lift': .15, 'bones': {
        'leftUpperArm': [-48, 0, -38], 'rightUpperArm': [-48, 0, 38],
        'leftUpperLeg': [-12, 0, 0], 'rightUpperLeg': [-12, 0, 0],
        'leftLowerLeg': [24, 0, 0], 'rightLowerLeg': [24, 0, 0]}},
    {'time': 1.12, 'lift': 0, 'bones': {}},
    {'time': 1.28, 'lift': -.025, 'bones': {
        'leftUpperLeg': [-22, 0, 0], 'rightUpperLeg': [-22, 0, 0],
        'leftLowerLeg': [44, 0, 0], 'rightLowerLeg': [44, 0, 0],
        'leftFoot': [-22, 0, 0], 'rightFoot': [-22, 0, 0], 'spine': [6, 0, 0]}},
    {'time': 1.65, 'lift': 0, 'bones': {}},
    {'time': 1.8, 'lift': 0, 'bones': {}},
]}


def number(value, low, high, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f'{label} 必须是 {low}–{high} 之间的有限数字')
    return value


def validate_action(value):
    if not isinstance(value, dict) or set(value) != {'id', 'name', 'duration', 'keyframes'}:
        raise ValueError('每个动作必须且只能包含 id、name、duration、keyframes')
    if not isinstance(value['id'], str) or not re.fullmatch(r'custom_[a-zA-Z0-9_-]{1,40}', value['id']):
        raise ValueError('动作 id 必须以 custom_ 开头，后接 1–40 个字母、数字、下划线或连字符')
    if not isinstance(value['name'], str) or not 1 <= len(value['name'].strip()) <= 30:
        raise ValueError('动作名称需要 1–30 个字符')
    duration = number(value['duration'], .4, 30, 'duration（秒）')
    frames = value['keyframes']
    if not isinstance(frames, list) or not 2 <= len(frames) <= 120:
        raise ValueError('keyframes 必须包含 2–120 个关键帧')
    previous = -1
    for i, frame in enumerate(frames):
        label = f'第 {i+1} 帧'
        if not isinstance(frame, dict) or set(frame) != {'time', 'lift', 'bones'}:
            raise ValueError(f'{label} 必须且只能包含 time、lift、bones')
        t = number(frame['time'], 0, duration, f'{label} time')
        if t <= previous:
            raise ValueError('关键帧 time 必须严格递增，不得重复')
        previous = t
        number(frame['lift'], -.12, .18, f'{label} lift（人物身高比例）')
        if not isinstance(frame['bones'], dict) or not set(frame['bones']) <= BONES:
            raise ValueError(f'{label} bones 包含不支持的骨骼名称')
        for bone, angles in frame['bones'].items():
            if not isinstance(angles, list) or len(angles) != 3:
                raise ValueError(f'{label} {bone} 需要 [x,y,z] 三个角度')
            for angle in angles:
                number(angle, -150, 150, f'{label} {bone} 旋转角度')
    if frames[0]['time'] != 0 or frames[-1]['time'] != duration:
        raise ValueError('第一帧 time 必须是 0，最后一帧 time 必须等于 duration')
    for frame in (frames[0], frames[-1]):
        if frame['lift'] != 0 or any(any(angles) for angles in frame['bones'].values()):
            raise ValueError('首尾帧必须回到站立姿势：lift 为 0，bones 为空或全零')
    result = copy.deepcopy(value)
    result['name'] = result['name'].strip()
    return result


def validate_document(value):
    if not isinstance(value, dict) or set(value) != {'version', 'actions'} or type(value['version']) is not int or value['version'] != 1:
        raise ValueError('仅支持包含 version=1 和 actions 的动作 JSON；动作文件与待机预设文件不同')
    if not isinstance(value['actions'], list) or len(value['actions']) > MAX_ACTIONS:
        raise ValueError(f'最多支持 {MAX_ACTIONS} 个自定义动作')
    actions = [validate_action(a) for a in value['actions']]
    if len({a['id'] for a in actions}) != len(actions):
        raise ValueError('同一文件中的动作 id 不能重复')
    document = {'version': 1, 'actions': actions}
    if len(json.dumps(document, ensure_ascii=False, indent=2).encode('utf-8')) > 950000:
        raise ValueError('动作库过大，请减少动作或关键帧，保证导出后也能重新导入')
    return document


def sample_action(action, at):
    """Return additive Euler radians and lift in units of character height."""
    frames = action['keyframes']
    at = max(0, min(action['duration'], at))
    a, b = frames[-2:]
    for left, right in zip(frames, frames[1:]):
        if at <= right['time']:
            a, b = left, right
            break
    weight = (at - a['time']) / (b['time'] - a['time'])
    weight = weight * weight * (3 - 2 * weight)
    bones = {}
    for bone in a['bones'].keys() | b['bones'].keys():
        start = a['bones'].get(bone, [0, 0, 0])
        end = b['bones'].get(bone, [0, 0, 0])
        bones[bone] = [math.radians(x + (y-x)*weight) for x,y in zip(start,end)]
    return bones, a['lift'] + (b['lift']-a['lift'])*weight


class ActionStore:
    def __init__(self, path):
        self.path = Path(path)
        self.lock = threading.RLock()
        self.document = validate_document(json.loads(self.path.read_text(encoding='utf-8'))) if self.path.exists() else {'version': 1, 'actions': []}

    def snapshot(self):
        with self.lock:
            return copy.deepcopy(self.document)

    def update(self, data):
        with self.lock:
            document = self.snapshot()
            if data.get('operation') == 'import':
                incoming = validate_document(data.get('document'))
                if not incoming['actions']:
                    raise ValueError('导入文件中没有动作')
                ids = {a['id'] for a in incoming['actions']}
                document['actions'] = [a for a in document['actions'] if a['id'] not in ids] + incoming['actions']
            elif data.get('operation') == 'delete':
                if not any(a['id'] == data.get('id') for a in document['actions']):
                    raise ValueError('自定义动作不存在；内置动作不能删除')
                document['actions'] = [a for a in document['actions'] if a['id'] != data['id']]
            else:
                raise ValueError('未知动作库操作')
            document = validate_document(document)
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.path.with_suffix('.tmp')
            temporary.write_text(json.dumps(document, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
            os.replace(temporary, self.path)
            self.document = document
            return self.snapshot()
