"""Short-lived local pose relay: no images, audio or landmark recordings."""
import copy
import math
import re

BONES = {'hips','spine','chest','upperChest','neck','head','leftEye','rightEye','jaw'}
for side in ('left','right'):
    BONES.update(side + part for part in ('Shoulder','UpperArm','LowerArm','Hand','UpperLeg','LowerLeg','Foot','Toes'))
    BONES.update(side + finger + joint for finger in ('Thumb','Index','Middle','Ring','Little') for joint in ('Metacarpal','Proximal','Intermediate','Distal'))
EXPRESSIONS = {'blink','blinkLeft','blinkRight','happy','aa'}


class PoseRelay:
    def __init__(self, clock):
        self.clock=clock;self.owner=None;self.sequence=-1;self.updated=-100.;self.pose=None

    def feed(self, data):
        source, seq, active = data.get('source'), data.get('sequence'), data.get('active')
        if not isinstance(source,str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}',source) or type(seq) is not int or seq<0 or not isinstance(active,bool):
            raise ValueError('姿态来源或序号无效')
        if source==self.owner and seq<=self.sequence:return
        if not active:
            if source==self.owner:self.sequence=seq;self.pose=None
            return
        bones, expressions=data.get('bones'),data.get('expressions')
        if not isinstance(bones,dict) or not set(bones).issubset(BONES) or not isinstance(expressions,dict) or not set(expressions).issubset(EXPRESSIONS):
            raise ValueError('姿态骨骼或表情字段无效')
        for q in bones.values():
            if not isinstance(q,list) or len(q)!=4 or any(isinstance(x,bool) or not isinstance(x,(int,float)) or not math.isfinite(x) for x in q) or not .95<=sum(x*x for x in q)<=1.05:
                raise ValueError('骨骼旋转必须是单位四元数')
        for x in expressions.values():
            if isinstance(x,bool) or not isinstance(x,(int,float)) or not math.isfinite(x) or not 0<=x<=1:
                raise ValueError('表情权重无效')
        self.owner=source;self.sequence=seq;self.updated=self.clock()
        self.pose={'source':source,'bones':copy.deepcopy(bones),'expressions':dict(expressions)}

    def snapshot(self):
        return self.pose if self.pose is not None and self.clock()-self.updated<1.2 else None
