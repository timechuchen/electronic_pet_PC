"""Versioned, validated JSON presets. Writes are atomic; imports contain no code."""
import copy
import json
import math
import os
import re
import threading
from pathlib import Path

IDLE_ACTIONS = ('breath', 'sway', 'look_around', 'wave', 'nod', 'shake', 'dance', 'jump', 'grace')
DEFAULT_PRESET = {
    'id': 'relaxed', 'name': '安静陪伴', 'idle_action': 'breath',
    'expression': 'neutral', 'speed': 1.0, 'auto_blink': True,
    'music_action': 'dance', 'music_threshold': .65,
    'music_start_seconds': 1.5, 'music_stop_seconds': 3.0,
}
DEFAULT_DOCUMENT = {'version': 1, 'selected': 'relaxed', 'presets': [
    DEFAULT_PRESET,
    dict(DEFAULT_PRESET, id='cheerful', name='轻松摇摆', idle_action='sway', expression='smile'),
    dict(DEFAULT_PRESET, id='curious', name='好奇观察', idle_action='look_around'),
]}


def validate_preset(value):
    if not isinstance(value, dict) or set(value) != set(DEFAULT_PRESET):
        raise ValueError('预设字段不完整或包含未知字段，请参照示例 JSON')
    result = copy.deepcopy(value)
    if not isinstance(value['id'], str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,48}', value['id']):
        raise ValueError('预设 id 必须为 1–48 个英文、数字、下划线或连字符')
    if not isinstance(value['name'], str) or not 1 <= len(value['name'].strip()) <= 40:
        raise ValueError('预设名称需要 1–40 个字符')
    result['name'] = value['name'].strip()
    if value['idle_action'] not in IDLE_ACTIONS or value['expression'] not in ('neutral', 'smile') or value['music_action'] not in ('dance', 'grace', 'sway', 'wave', 'jump'):
        raise ValueError('预设包含不支持的动作或表情')
    if not isinstance(value['auto_blink'], bool):
        raise ValueError('auto_blink 必须是布尔值')
    for key, low, high in [('speed', .25, 2), ('music_threshold', .2, .95), ('music_start_seconds', .5, 10), ('music_stop_seconds', 1, 15)]:
        number = value[key]
        if isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number) or not low <= number <= high:
            raise ValueError(f'{key} 必须在 {low}–{high} 之间')
    return result


def validate_document(value):
    if not isinstance(value, dict) or set(value) != {'version', 'selected', 'presets'} or type(value['version']) is not int or value['version'] != 1:
        raise ValueError('仅支持 version=1 的预设文件')
    if not isinstance(value['presets'], list) or not 1 <= len(value['presets']) <= 50:
        raise ValueError('一个文件可包含 1–50 个预设')
    presets = [validate_preset(item) for item in value['presets']]
    ids = [item['id'] for item in presets]
    if len(set(ids)) != len(ids) or value['selected'] not in ids:
        raise ValueError('预设 id 重复或 selected 不存在')
    return {'version': 1, 'selected': value['selected'], 'presets': presets}


class PresetStore:
    def __init__(self, path):
        self.path = Path(path)
        self.lock = threading.RLock()
        self.document = validate_document(json.loads(self.path.read_text())) if self.path.exists() else copy.deepcopy(DEFAULT_DOCUMENT)

    def snapshot(self):
        with self.lock:
            return copy.deepcopy(self.document)

    def selected(self):
        with self.lock:
            return copy.deepcopy(next(p for p in self.document['presets'] if p['id'] == self.document['selected']))

    def update(self, data):
        with self.lock:
            document = self.snapshot()
            operation = data.get('operation')
            if operation == 'select':
                document['selected'] = data.get('id')
            elif operation == 'save':
                preset = validate_preset(data.get('preset'))
                document['presets'] = [p for p in document['presets'] if p['id'] != preset['id']] + [preset]
                document['selected'] = preset['id']
            elif operation == 'import':
                document = data.get('document')
            else:
                raise ValueError('未知预设操作')
            document = validate_document(document)
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.path.with_suffix('.tmp')
            temporary.write_text(json.dumps(document, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            os.replace(temporary, self.path)
            self.document = document
            return self.snapshot()
