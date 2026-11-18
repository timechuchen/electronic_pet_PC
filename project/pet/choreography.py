"""原创的优雅舞蹈编排（纯 Python，无素材依赖）。

这支舞以“呼吸—绽放—旋身—回眸—归位”为线索，只用 VRM 归一化骨骼的
局部欧拉角来表达。所有关键帧按循环首尾闭合设计，配合 Hermite 插值、
跟随动作（手腕轻微滞后）和一层很轻的呼吸，让动作在桌宠尺寸下也显得
柔软、连贯。

坐标约定（与 web/src/main.js 中 `setFromEuler` 一致）：
- 左臂 z 越大越向下（+1.22 为自然下垂），右臂相反。
- 左臂 y 为负时向前摆，右臂 y 为正时向前摆。
- 左前臂 y 为负时向身体内侧弯，右前臂 y 为正时向内侧弯。
- 胸口 y 为负时转向角色右侧，为正时转向角色左侧。
- 头部 x 为正时微抬下巴，负时低头；y 为左右转头，z 为歪头。
"""
import math

DURATION = 24.0

# 自然站姿。所有关键帧都在这套姿态上覆盖需要变化的骨骼。
BASE = {
    "leftUpperArm": [0.02, -0.10, 1.08],
    "rightUpperArm": [0.02, 0.10, -1.08],
    "leftLowerArm": [0.0, -0.26, 0.05],
    "rightLowerArm": [0.0, 0.26, -0.05],
    "leftHand": [0.12, -0.06, -0.18],
    "rightHand": [0.12, 0.06, 0.18],
    "leftShoulder": [0.0, 0.0, 0.0],
    "rightShoulder": [0.0, 0.0, 0.0],
    "hips": [0.0, 0.0, 0.0],
    "spine": [0.0, 0.0, 0.0],
    "chest": [0.0, 0.0, 0.0],
    "neck": [0.0, 0.0, 0.0],
    "head": [0.0, 0.0, 0.0],
    "leftUpperLeg": [0.0, 0.0, 0.02],
    "rightUpperLeg": [0.0, 0.0, -0.02],
}

# 关键帧：时间、覆盖姿态、名字。间隔约 1.6 秒，像一支 75 BPM 的慢板。
# 动作语汇以“打开的长线条”为主：小体型角色做头顶动作时手容易挤到耳朵，
# 所以高潮使用 45°–55° 的 V 形打开，而不是完全竖直。
_KEYFRAMES = [
    (0.0, {}, "起势"),
    (1.6, {
        "leftUpperArm": [0.02, -0.12, 0.86], "rightUpperArm": [0.02, 0.12, -0.86],
        "leftLowerArm": [0.0, -0.32, 0.04], "rightLowerArm": [0.0, 0.32, -0.04],
        "leftHand": [0.16, -0.06, -0.30], "rightHand": [0.16, 0.06, 0.30],
        "leftShoulder": [0.0, -0.02, -0.02], "rightShoulder": [0.0, 0.02, 0.02],
        "chest": [0.03, 0.0, 0.0], "head": [0.07, 0.0, -0.01],
    }, "呼吸"),
    (3.2, {
        "leftUpperArm": [0.02, -0.18, -0.30], "rightUpperArm": [0.02, 0.18, 0.30],
        "leftLowerArm": [0.0, 0.12, 0.0], "rightLowerArm": [0.0, -0.12, 0.0],
        "leftHand": [0.10, 0.0, -0.44], "rightHand": [0.10, 0.0, 0.44],
        "leftShoulder": [0.0, -0.02, -0.08], "rightShoulder": [0.0, 0.02, 0.08],
        "chest": [0.05, 0.0, 0.0], "spine": [0.02, 0.0, 0.0],
        "head": [0.13, 0.0, 0.0], "neck": [0.03, 0.0, 0.0],
    }, "盛开"),
    (4.8, {
        "leftUpperArm": [0.02, -0.20, -0.50], "rightUpperArm": [0.10, 0.42, -1.12],
        "leftLowerArm": [0.0, 0.40, -0.02], "rightLowerArm": [0.06, 1.02, -0.06],
        "leftHand": [0.18, 0.02, -0.42], "rightHand": [0.40, 0.02, 0.42],
        "leftShoulder": [0.0, -0.01, -0.07], "rightShoulder": [0.0, 0.03, 0.02],
        "chest": [0.03, -0.06, 0.15], "spine": [0.01, -0.02, 0.05],
        "hips": [0.0, -0.02, 0.05],
        "head": [0.10, -0.02, 0.18], "neck": [0.02, -0.01, 0.05],
    }, "托月"),
    (6.4, {
        "leftUpperArm": [0.02, -0.50, 0.74], "rightUpperArm": [0.02, 0.50, -0.74],
        "leftLowerArm": [0.0, -0.55, 0.02], "rightLowerArm": [0.0, 0.55, -0.02],
        "leftHand": [0.14, -0.04, -0.34], "rightHand": [0.14, 0.04, 0.34],
        "leftShoulder": [0.0, -0.02, 0.0], "rightShoulder": [0.0, 0.02, 0.0],
        "chest": [-0.05, 0.0, 0.0], "spine": [-0.02, 0.0, 0.0],
        "head": [-0.06, 0.0, -0.02], "neck": [-0.02, 0.0, 0.0],
    }, "收"),
    (8.0, {
        "leftUpperArm": [0.02, -0.30, 0.40], "rightUpperArm": [0.02, 0.30, 0.55],
        "leftLowerArm": [0.0, -0.10, 0.02], "rightLowerArm": [0.0, -0.10, 0.02],
        "leftHand": [0.16, 0.02, -0.44], "rightHand": [0.16, -0.02, 0.46],
        "leftShoulder": [0.0, -0.02, 0.02], "rightShoulder": [0.0, 0.02, 0.07],
        "chest": [0.02, -0.30, -0.12], "spine": [0.01, -0.08, -0.05],
        "hips": [0.0, -0.12, -0.04],
        "head": [0.06, -0.15, -0.12], "neck": [0.0, -0.03, -0.03],
    }, "右旋"),
    (9.6, {
        "leftUpperArm": [0.02, -0.34, 0.30], "rightUpperArm": [0.02, 0.26, 0.62],
        "leftLowerArm": [0.0, -0.02, 0.04], "rightLowerArm": [0.0, 0.10, 0.0],
        "leftHand": [0.16, 0.02, -0.46], "rightHand": [0.16, -0.02, 0.48],
        "leftShoulder": [0.0, -0.02, 0.0], "rightShoulder": [0.0, 0.02, 0.08],
        "chest": [0.02, -0.26, -0.14], "spine": [0.01, -0.08, -0.06],
        "hips": [0.0, -0.10, -0.05],
        "head": [0.07, -0.12, -0.12], "neck": [0.01, -0.03, -0.03],
    }, "回波"),
    (11.2, {
        "leftUpperArm": [0.02, -0.30, -0.60], "rightUpperArm": [0.02, 0.30, -0.30],
        "leftLowerArm": [0.0, 0.18, -0.02], "rightLowerArm": [0.0, 0.02, -0.04],
        "leftHand": [0.16, 0.0, -0.48], "rightHand": [0.16, -0.02, 0.44],
        "leftShoulder": [0.0, -0.02, -0.08], "rightShoulder": [0.0, 0.02, 0.0],
        "chest": [0.02, 0.30, 0.14], "spine": [0.01, 0.09, 0.06],
        "hips": [0.0, 0.12, 0.05],
        "head": [0.08, -0.10, 0.16], "neck": [0.01, -0.02, 0.04],
    }, "左旋"),
    (12.8, {
        "leftUpperArm": [0.02, -0.36, 0.58], "rightUpperArm": [0.04, 0.35, -1.15],
        "leftLowerArm": [0.0, -0.38, 0.04], "rightLowerArm": [0.05, 1.00, -0.05],
        "leftHand": [0.14, -0.02, -0.32], "rightHand": [0.40, 0.02, 0.40],
        "leftShoulder": [0.0, -0.02, 0.0], "rightShoulder": [0.0, 0.03, 0.01],
        "chest": [-0.02, 0.06, 0.04], "spine": [-0.01, 0.02, 0.02],
        "hips": [0.0, 0.02, 0.01],
        "head": [-0.06, 0.05, 0.07], "neck": [-0.02, 0.01, 0.02],
    }, "心口"),
    (14.4, {
        "leftUpperArm": [0.02, -0.52, 0.54], "rightUpperArm": [0.10, 0.42, -0.84],
        "leftLowerArm": [0.0, -0.95, 0.04], "rightLowerArm": [0.10, 1.62, -0.08],
        "leftHand": [0.36, 0.02, -0.46], "rightHand": [0.54, 0.0, 0.64],
        "leftShoulder": [0.0, -0.02, 0.01], "rightShoulder": [0.0, 0.03, 0.05],
        "chest": [0.0, 0.04, 0.07], "spine": [0.0, 0.02, 0.02],
        "hips": [0.0, 0.02, 0.03],
        "head": [0.02, 0.06, 0.20], "neck": [0.0, 0.02, 0.05],
    }, "含羞"),
    (16.0, {
        "leftUpperArm": [0.02, -0.48, 0.52], "rightUpperArm": [0.02, 0.16, 0.28],
        "leftLowerArm": [0.0, -1.28, 0.04], "rightLowerArm": [0.0, -0.06, -0.02],
        "leftHand": [0.40, 0.04, -0.50], "rightHand": [0.14, 0.0, 0.46],
        "leftShoulder": [0.0, -0.02, 0.02], "rightShoulder": [0.0, 0.02, 0.07],
        "chest": [0.02, -0.26, -0.13], "spine": [0.01, -0.08, -0.05],
        "hips": [0.0, -0.10, -0.04],
        "head": [0.07, -0.32, -0.16], "neck": [0.0, -0.06, -0.04],
    }, "回眸"),
    (17.6, {
        "leftUpperArm": [0.02, -0.22, -0.38], "rightUpperArm": [0.02, 0.22, 0.38],
        "leftLowerArm": [0.0, 0.10, 0.0], "rightLowerArm": [0.0, -0.10, 0.0],
        "leftHand": [0.10, 0.0, -0.44], "rightHand": [0.10, 0.0, 0.44],
        "leftShoulder": [0.0, 0.0, -0.08], "rightShoulder": [0.0, 0.0, 0.08],
        "chest": [0.06, 0.0, 0.0], "spine": [0.02, 0.0, 0.0],
        "hips": [0.0, 0.0, 0.0],
        "head": [0.15, 0.0, 0.0], "neck": [0.04, 0.0, 0.0],
    }, "展翼"),
    (19.2, {
        "leftUpperArm": [0.02, -0.20, -0.62], "rightUpperArm": [0.02, 0.20, 0.35],
        "leftLowerArm": [0.0, 0.24, -0.02], "rightLowerArm": [0.0, -0.06, 0.02],
        "leftHand": [0.04, 0.0, -0.46], "rightHand": [0.04, 0.0, 0.46],
        "leftShoulder": [0.0, 0.0, -0.10], "rightShoulder": [0.0, 0.0, 0.08],
        "chest": [0.07, 0.0, 0.08], "spine": [0.02, 0.0, 0.03],
        "hips": [0.0, 0.0, 0.02],
        "head": [0.16, 0.0, 0.14], "neck": [0.05, 0.0, 0.05],
    }, "云端"),
    (20.8, {
        "leftUpperArm": [0.02, -0.18, -0.35], "rightUpperArm": [0.02, 0.20, 0.62],
        "leftLowerArm": [0.0, 0.06, -0.02], "rightLowerArm": [0.0, -0.24, 0.02],
        "leftHand": [0.04, 0.0, -0.48], "rightHand": [0.04, 0.0, 0.46],
        "leftShoulder": [0.0, 0.0, -0.07], "rightShoulder": [0.0, 0.0, 0.11],
        "chest": [0.05, 0.04, -0.08], "spine": [0.02, 0.02, -0.03],
        "hips": [0.0, 0.03, -0.02],
        "head": [0.17, 0.04, -0.12], "neck": [0.05, 0.01, -0.04],
    }, "流光"),
    (22.4, {
        "leftUpperArm": [0.02, -0.22, 0.28], "rightUpperArm": [0.02, 0.22, -0.28],
        "leftLowerArm": [0.0, -0.36, 0.03], "rightLowerArm": [0.0, 0.36, -0.03],
        "leftHand": [0.12, -0.02, -0.34], "rightHand": [0.12, 0.02, 0.34],
        "leftShoulder": [0.0, -0.01, 0.0], "rightShoulder": [0.0, 0.01, 0.0],
        "chest": [0.01, 0.0, -0.05], "spine": [0.0, 0.0, -0.02],
        "hips": [0.0, 0.0, -0.02],
        "head": [0.03, -0.02, -0.07], "neck": [0.0, 0.0, -0.02],
    }, "落"),
    (23.2, {
        "leftUpperArm": [0.02, -0.10, 1.00], "rightUpperArm": [0.02, 0.10, -1.00],
        "leftLowerArm": [0.0, -0.28, 0.05], "rightLowerArm": [0.0, 0.28, -0.05],
        "leftHand": [0.12, -0.06, -0.20], "rightHand": [0.12, 0.06, 0.20],
        "chest": [0.0, 0.0, 0.0], "spine": [0.0, 0.0, 0.0],
        "head": [-0.03, 0.0, -0.02], "neck": [-0.01, 0.0, 0.0],
    }, "归"),
    (24.0, {}, "起势"),
]

# 每个关键帧补全为完整姿态；首尾姿态必须相同，循环才不会跳。
_key_poses = []
for _time, _overrides, _label in _KEYFRAMES:
    pose = {name: list(value) for name, value in BASE.items()}
    for name, value in _overrides.items():
        pose[name] = list(value)
    _key_poses.append((_time, pose, _label))

# 首尾闭合校验：t=0 与 t=24 的骨骼完全一致。
for _name in BASE:
    if _key_poses[0][1][_name] != _key_poses[-1][1][_name]:
        _key_poses[-1][1][_name] = list(_key_poses[0][1][_name])

_TIMES = [item[0] for item in _key_poses]
_BONES = tuple(BASE)
_CHANNELS = [(name, axis) for name in _BONES for axis in range(3)]


def _hermite(p0, p1, m0, m1, s):
    s2 = s * s
    s3 = s2 * s
    return ((2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * m0 +
            (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * m1)


def _channel_value(name, axis, t):
    """在周期关键帧上做 Hermite 插值；返回 (值, 所在段索引)。"""
    # 找到 t 所在的关键帧区间。
    index = 0
    for i in range(len(_TIMES) - 1):
        if t < _TIMES[i + 1]:
            index = i
            break
    else:
        index = len(_TIMES) - 2
    t0, t1 = _TIMES[index], _TIMES[index + 1]
    span = max(1e-6, t1 - t0)
    s = min(1.0, max(0.0, (t - t0) / span))

    def value_at(i):
        return _key_poses[i][1][name][axis]

    # 循环时，首尾关键帧是同一个姿态；用相邻关键帧的有限差分求切线。
    prev = index - 1 if index > 0 else len(_key_poses) - 2
    nxt = index + 2 if index + 2 < len(_key_poses) else 1
    prev_time = _TIMES[prev] if index > 0 else _TIMES[prev] - DURATION
    next_time = _TIMES[nxt] if index + 2 < len(_key_poses) else _TIMES[nxt] + DURATION
    slope0 = (value_at(index + 1) - value_at(prev)) / max(1e-6, _TIMES[index + 1] - prev_time)
    slope1 = (value_at(nxt) - value_at(index)) / max(1e-6, next_time - _TIMES[index])
    return _hermite(value_at(index), value_at(index + 1), slope0 * span, slope1 * span, s), index


def _label_at(t):
    index = 0
    for i in range(len(_TIMES) - 1):
        if t < _TIMES[i + 1]:
            index = i
            break
    else:
        index = len(_TIMES) - 2
    # 离后一个关键帧更近时，用后一个的名字。
    return _key_poses[index + 1][2] if t - _TIMES[index] > (_TIMES[index + 1] - _TIMES[index]) * .55 else _key_poses[index][2]


def sample(t, live=True):
    """返回 t 时刻的骨骼姿态。t 会按循环时长取模。"""
    t = float(t) % DURATION
    pose = {name: [0.0, 0.0, 0.0] for name in _BONES}
    for name, axis in _CHANNELS:
        pose[name][axis], _ = _channel_value(name, axis, t)

    if live:
        # 极轻的呼吸与重心摆动，让关键帧之间的静止段落也在“活着”。
        breath = math.sin(math.tau * t / 6.0)
        sway = math.sin(math.tau * t / 12.0)
        pose["chest"][0] += 0.012 * breath
        pose["chest"][2] += 0.010 * sway
        pose["hips"][2] += 0.008 * sway
        pose["head"][0] += 0.010 * math.sin(math.tau * t / 6.0 - .5)
        pose["head"][2] += 0.008 * math.sin(math.tau * t / 12.0 + .7)
        pose["leftUpperArm"][2] += 0.012 * breath
        pose["rightUpperArm"][2] -= 0.012 * breath

        # 手腕和手肘的跟随：取一点点“过去”的姿态，让末端慢半拍。
        lag = 0.11
        for name, weight in (("leftLowerArm", .18), ("rightLowerArm", .18),
                             ("leftHand", .38), ("rightHand", .38)):
            past = (t - lag) % DURATION
            for axis in range(3):
                prev, _ = _channel_value(name, axis, past)
                pose[name][axis] = pose[name][axis] * (1 - weight) + prev * weight

        # 停留时的指尖细流，只在手腕上，幅度很小。
        ripple = math.sin(math.tau * t / 3.0)
        pose["leftHand"][2] -= 0.020 * ripple
        pose["rightHand"][2] += 0.020 * ripple

    return {name: [round(component, 5) for component in value] for name, value in pose.items()}


def label(t):
    return _label_at(float(t) % DURATION)
