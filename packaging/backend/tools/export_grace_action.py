#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 Python 编排导出成 AI 桌宠可导入的动作 JSON。

动作库格式（version=1）使用“相对站姿的角度偏移”，单位为度，且要求首尾帧
回到站姿。这里以 t=0 的姿态为基准做差分，保留整支舞的相对运动，并让首尾
帧为零，方便 action store 校验和循环。
"""
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pet import choreography
from pet.actions import validate_document

FRAMES = 120  # 动作库上限 120
OUT = ROOT.parent.parent / 'releases' / '轻舞-动作.json'


def main():
    base = choreography.sample(0)
    steps = FRAMES - 1
    keyframes = []
    for index in range(FRAMES):
        t = choreography.DURATION * index / steps
        frame = {
            'time': round(t, 4),
            'lift': 0,
            'bones': {},
        }
        if 0 < index < steps:
            pose = choreography.sample(t)
            bones = {}
            for bone, angles in pose.items():
                offset = [round(math.degrees(angles[axis] - base[bone][axis]), 2) for axis in range(3)]
                if any(abs(value) >= 0.01 for value in offset):
                    bones[bone] = offset
            frame['bones'] = bones
        keyframes.append(frame)

    document = {
        'version': 1,
        'actions': [{
            'id': 'custom_grace',
            'name': '轻舞',
            'duration': choreography.DURATION,
            'keyframes': keyframes,
        }],
    }
    validate_document(document)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(document, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'wrote {OUT} ({OUT.stat().st_size} bytes, {len(keyframes)} keyframes)')


if __name__ == '__main__':
    main()
