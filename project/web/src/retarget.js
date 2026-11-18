// Retarget math follows the MIT-licensed pixiv/three-vrm Mixamo example.
// https://github.com/pixiv/three-vrm/blob/dev/packages/three-vrm/examples/humanoidAnimation/loadMixamoAnimation.js
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const rigMap = {
  Hips:'hips', Spine:'spine', Spine1:'chest', Spine2:'upperChest', Neck:'neck', Head:'head',
  LeftShoulder:'leftShoulder', LeftArm:'leftUpperArm', LeftForeArm:'leftLowerArm', LeftHand:'leftHand',
  RightShoulder:'rightShoulder', RightArm:'rightUpperArm', RightForeArm:'rightLowerArm', RightHand:'rightHand',
  LeftUpLeg:'leftUpperLeg', LeftLeg:'leftLowerLeg', LeftFoot:'leftFoot', LeftToeBase:'leftToes',
  RightUpLeg:'rightUpperLeg', RightLeg:'rightLowerLeg', RightFoot:'rightFoot', RightToeBase:'rightToes',
};
for (const side of ['Left','Right']) {
  const prefix = side.toLowerCase();
  for (const finger of ['Thumb','Index','Middle','Ring','Pinky']) {
    const vrmFinger = finger === 'Pinky' ? 'Little' : finger;
    const joints = finger === 'Thumb' ? ['Metacarpal','Proximal','Distal'] : ['Proximal','Intermediate','Distal'];
    joints.forEach((joint,i) => { rigMap[`${side}Hand${finger}${i+1}`] = `${prefix}${vrmFinger}${joint}`; });
  }
}
const cleanName = name => name.replace(/^mixamorig[:_]?/, '');
export async function loadDance(url, vrm) {
  const asset = await new FBXLoader().loadAsync(url);
  asset.updateMatrixWorld(true);
  const source = asset.animations[0];
  if (!source) throw new Error('FBX 中没有动画轨道');
  let hips;
  asset.traverse(node => { if (cleanName(node.name) === 'Hips') hips = node; });
  if (!hips) throw new Error('FBX 中没有找到 Mixamo 髋骨');
  const motionHeight = hips.getWorldPosition(new THREE.Vector3()).y;
  if (Math.abs(motionHeight) < 0.001) throw new Error('FBX 骨架高度无效');
  const scale = vrm.humanoid.normalizedRestPose.hips.position[1] / motionHeight;
  const tracks = [];
  const inverse = new THREE.Quaternion(), parent = new THREE.Quaternion(), q = new THREE.Quaternion();
  for (const track of source.tracks) {
    const dot = track.name.lastIndexOf('.');
    const nodeName = track.name.slice(0, dot), property = track.name.slice(dot + 1);
    const key = cleanName(nodeName);
    let boneName = rigMap[key];
    // This supplied VRM has chest, but no upperChest. Its CSV maps Spine2 to chest.
    if (!vrm.humanoid.getNormalizedBoneNode('upperChest')) {
      if (key === 'Spine1') continue;
      if (key === 'Spine2') boneName = 'chest';
    }
    if (!boneName) continue;
    const target = vrm.humanoid.getNormalizedBoneNode(boneName);
    const original = asset.getObjectByName(nodeName);
    if (!target || !original) continue;
    original.getWorldQuaternion(inverse).invert();
    original.parent.getWorldQuaternion(parent);
    if (track instanceof THREE.QuaternionKeyframeTrack) {
      const values = track.values.slice();
      for (let i=0; i<values.length; i+=4) {
        q.fromArray(values,i).premultiply(parent).multiply(inverse).toArray(values,i);
        if (vrm.meta.metaVersion === '0') { values[i] *= -1; values[i+2] *= -1; }
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${target.name}.quaternion`, track.times, values));
    } else if (property === 'position' && boneName === 'hips') {
      const values = track.values.slice();
      const startX = values[0], startZ = values[2];
      for (let i=0; i<values.length; i+=3) {
        const sign = vrm.meta.metaVersion === '0' ? -1 : 1;
        values[i] = (values[i] - startX) * scale * sign;
        values[i+1] *= scale;
        values[i+2] = (values[i+2] - startZ) * scale * sign;
      }
      tracks.push(new THREE.VectorKeyframeTrack(`${target.name}.position`, track.times, values));
    }
  }
  if (tracks.length < 10) throw new Error('可映射的舞蹈骨骼不足');
  return new THREE.AnimationClip('Hip Hop Dancing', source.duration, tracks);
}
