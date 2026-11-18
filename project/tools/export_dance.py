#!/usr/bin/env python3
"""把编排采样成预览用的 JSON（仅开发工具，不参与运行时）。"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pet import choreography

FPS = 30
OUT = Path(__file__).resolve().parent / "poser" / "dance.json"


def main():
    frames = []
    steps = int(round(choreography.DURATION * FPS))
    for index in range(steps + 1):
        t = index / FPS
        frames.append({
            "t": round(t, 4),
            "bones": choreography.sample(t),
            "label": choreography.label(t),
        })
    OUT.write_text(json.dumps({
        "duration": choreography.DURATION,
        "fps": FPS,
        "frames": frames,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes, {len(frames)} frames)")


if __name__ == "__main__":
    main()
