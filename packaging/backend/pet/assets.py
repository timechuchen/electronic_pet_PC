"""Local VRM/FBX library. Opaque filenames, bounded input and atomic manifests."""
import copy
import json
import math
import os
import re
import struct
import threading
import uuid
from pathlib import Path

MAX_FILE_SIZE = 128 * 1024 * 1024
BONES = set(('hips spine chest upperChest neck head leftEye rightEye jaw '
    'leftShoulder rightShoulder leftUpperArm rightUpperArm leftLowerArm rightLowerArm '
    'leftHand rightHand leftUpperLeg rightUpperLeg leftLowerLeg rightLowerLeg '
    'leftFoot rightFoot leftToes rightToes').split())
for side in ('left', 'right'):
    for finger in ('Thumb', 'Index', 'Middle', 'Ring', 'Little'):
        for joint in (('Metacarpal', 'Proximal', 'Distal') if finger == 'Thumb' else ('Proximal', 'Intermediate', 'Distal')):
            BONES.add(side + finger + joint)


def validate_file(kind, raw):
    if not raw or len(raw) > MAX_FILE_SIZE:
        raise ValueError('单个素材需要在 1 字节至 128 MB 之间')
    if kind == 'vrm':
        if len(raw) < 20 or raw[:4] != b'glTF':
            raise ValueError('不是有效的 VRM / GLB 文件')
        version, size, json_size, chunk = struct.unpack_from('<IIII', raw, 4)
        if version != 2 or size != len(raw) or chunk != 0x4E4F534A or json_size > len(raw)-20:
            raise ValueError('VRM 文件结构不完整')
        try:
            document = json.loads(raw[20:20+json_size])
            extensions = document.get('extensions', {})
            if not ('VRM' in extensions or 'VRMC_vrm' in extensions):
                raise ValueError('文件不含 VRM 0.x 或 VRM 1.0 人形描述')
            for item in document.get('buffers', []) + document.get('images', []):
                uri = item.get('uri', '')
                if uri and not uri.startswith('data:'):
                    raise ValueError('请导出纹理和缓冲区内嵌的 VRM 文件')
        except (AttributeError, TypeError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError('VRM 描述数据无效') from exc
    elif kind == 'fbx':
        if not raw.startswith(b'Kaydara FBX Binary  \x00\x1a\x00') and not re.search(rb'FBXHeaderExtension\s*:', raw[:65536]):
            raise ValueError('不是有效的二进制或 ASCII FBX 文件')
    else:
        raise ValueError('只支持 .vrm 模型和 .fbx 动作')


class AssetStore:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.path = self.root / 'library.json'
        self.lock = threading.RLock()
        self.document = json.loads(self.path.read_text(encoding='utf-8')) if self.path.exists() else {
            'version': 1, 'revision': 0, 'selected': 'builtin', 'models': [], 'motions': []}

    def snapshot(self):
        with self.lock:
            return copy.deepcopy(self.document)

    def selected_model(self):
        with self.lock:
            return next((m['url'] for m in self.document['models'] if m['id'] == self.document['selected']), '/assets/兰洛.vrm')

    def resolve(self, filename):
        with self.lock:
            if not re.fullmatch(r'(model|fbx)_[a-f0-9]{32}\.(vrm|fbx)', filename):
                return None
            if not any(a['url'] == '/user-assets/' + filename for a in self.document['models'] + self.document['motions']):
                return None
            return self.root / filename

    def _save(self, document):
        document['revision'] = self.document['revision'] + 1
        temporary = self.path.with_suffix('.tmp')
        temporary.write_text(json.dumps(document, ensure_ascii=False, allow_nan=False, indent=2), encoding='utf-8')
        os.replace(temporary, self.path)
        self.document = document
        return self.snapshot()

    def import_file(self, metadata, raw):
        if not isinstance(metadata, dict):
            raise ValueError('素材信息必须是对象')
        kind, name = metadata.get('kind'), metadata.get('name')
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 120 or not name.lower().endswith('.' + str(kind)):
            raise ValueError('文件名需要与 .vrm / .fbx 格式一致，且不超过 120 字符')
        validate_file(kind, raw)
        entry = {'id': ('model_' if kind == 'vrm' else 'fbx_') + uuid.uuid4().hex, 'name': name.strip(), 'size': len(raw)}
        if kind == 'fbx':
            duration, clip, mapping = metadata.get('duration'), metadata.get('clip'), metadata.get('mapping')
            if type(duration) not in (float, int) or not math.isfinite(duration) or not .1 <= duration <= 3600:
                raise ValueError('动作片段时长需要在 0.1–3600 秒之间')
            if type(clip) is not int or not 0 <= clip < 1000:
                raise ValueError('动作片段编号无效')
            if not isinstance(mapping, dict) or not 1 <= len(mapping) <= len(BONES):
                raise ValueError('请先设置人形骨骼映射')
            if any(k not in BONES or not isinstance(v, str) or not 1 <= len(v) <= 200 for k, v in mapping.items()) or len(set(mapping.values())) != len(mapping):
                raise ValueError('骨骼映射无效或重复')
            clip_name = metadata.get('clipName', '')
            if not isinstance(clip_name, str) or len(clip_name) > 200:
                raise ValueError('动作片段名称无效')
            in_place = metadata.get('inPlace', True)
            if not isinstance(in_place, bool):
                raise ValueError('原地播放设置必须为布尔值')
            entry.update(duration=duration, clip=clip, mapping=mapping, clipName=clip_name, inPlace=in_place)
        filename = entry['id'] + '.' + kind
        entry['url'] = '/user-assets/' + filename
        with self.lock:
            document = self.snapshot()
            key, limit = ('models', 16) if kind == 'vrm' else ('motions', 64)
            if len(document[key]) >= limit:
                raise ValueError(f'素材库已达 {limit} 个上限，请先移除不用的素材')
            target = self.root / filename
            try:
                target.write_bytes(raw)
                document[key].append(entry)
                # Import does not replace the active model until the user selects it.
                return self._save(document)
            except Exception:
                target.unlink(missing_ok=True)
                raise

    def update(self, data):
        with self.lock:
            document = self.snapshot()
            identifier = data.get('id')
            if data.get('operation') == 'select':
                if identifier != 'builtin' and not any(a['id'] == identifier for a in document['models']):
                    raise ValueError('模型不存在')
                document['selected'] = identifier
                return self._save(document)
            if data.get('operation') != 'delete':
                raise ValueError('未知素材库操作')
            entry = next((a for a in document['models'] + document['motions'] if a['id'] == identifier), None)
            if entry is None:
                raise ValueError('自定义素材不存在；内置素材不能移除')
            for key in ('models', 'motions'):
                document[key] = [a for a in document[key] if a['id'] != identifier]
            if document['selected'] == identifier:
                document['selected'] = 'builtin'
            result = self._save(document)
            # The manifest is authoritative even if an OS file lock delays cleanup.
            try:
                (self.root / entry['url'].rsplit('/', 1)[1]).unlink(missing_ok=True)
            except OSError:
                pass
            return result
