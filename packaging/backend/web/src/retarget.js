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
// Keep import parsing local: FBX textures are irrelevant to skeleton animation.
export function parseFBX(buffer) {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(() => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=');
  let asset;
  try { asset = new FBXLoader(manager).parse(buffer, ''); }
  catch(error) { throw new Error('无法解析这个 FBX 文件。请重新导出为 FBX 7.x，并启用烘焙动画。', {cause:error}); }
  asset.traverse(node => { if (node.isSkinnedMesh) node.skeleton.pose(); });
  asset.updateMatrixWorld(true);
  if (!asset.animations.length) { disposeFBX(asset); throw new Error('FBX 中没有动画片段，请导出时启用烘焙动画'); }
  return asset;
}
export function disposeFBX(asset) {
  asset?.traverse(node => {
    node.geometry?.dispose();
    for (const material of [node.material].flat().filter(Boolean)) {
      for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
      material.dispose();
    }
  });
}
const normalize = name => name.split(/[|:]/).pop().replace(/^mixamorig/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
export const humanoidBones = [...new Set(Object.values(rigMap))];
const aliases = {pelvis:'hips', rootpelvis:'hips', spine01:'spine', spine02:'chest', spine03:'upperChest', neck01:'neck'};
for (const side of ['left', 'right']) {
  const short = side[0];
  for (const [source,target] of Object.entries({clavicle:'Shoulder',upperarm:'UpperArm',lowerarm:'LowerArm',forearm:'LowerArm',hand:'Hand',thigh:'UpperLeg',calf:'LowerLeg',foot:'Foot',ball:'Toes',toe:'Toes'})) {
    aliases[source+short] = side+target;
    aliases[short+source] = side+target;
  }
}
export function suggestMapping(asset) {
  const lookup = {...aliases};
  for (const [source,target] of Object.entries(rigMap)) lookup[normalize(source)] = target;
  for (const bone of humanoidBones) lookup[normalize(bone)] = bone;
  const mapping = {};
  asset.traverse(node => {
    const target = lookup[normalize(node.name.replace(/^DEF[-_]/i, ''))];
    if (target && !mapping[target]) mapping[target] = node.name;
  });
  return mapping;
}
export function sourceBones(asset) {
  const names = new Set();
  asset.traverse(node => { if (node.isBone) names.add(node.name); });
  for (const clip of asset.animations) for (const track of clip.tracks) {
    const name = track.name.slice(0, track.name.lastIndexOf('.'));
    if (asset.getObjectByName(name)) names.add(name);
  }
  return [...names].sort();
}
export function retargetClip(asset, vrm, clipIndex=0, mapping=suggestMapping(asset), {inPlace=false}={}) {
  asset.updateMatrixWorld(true);
  const source = asset.animations[clipIndex];
  if (!source || !Number.isFinite(source.duration) || source.duration < .1 || source.duration > 3600) throw new Error('动画片段需为 0.1–3600 秒');
  if (new Set(Object.values(mapping)).size !== Object.keys(mapping).length) throw new Error('一个源骨骼不能重复映射，请检查骨骼对应关系');
  const reverse = new Map(Object.entries(mapping).map(([target,source]) => [source,target]));
  const hips = asset.getObjectByName(mapping.hips || '');
  const hipPosition = hips?.getWorldPosition(new THREE.Vector3());
  const feet = ['leftFoot','rightFoot'].map(k => asset.getObjectByName(mapping[k] || '')).filter(Boolean);
  const ground = feet.length ? Math.min(...feet.map(n => n.getWorldPosition(new THREE.Vector3()).y)) : 0;
  const sourceHeight = hipPosition ? Math.abs(hipPosition.y-ground) : 0;
  const restPose=vrm.humanoid.normalizedRestPose;
  const restHips=restPose.hips?.position || [0,1,0];
  const legHeights=['left','right'].map(side=>['UpperLeg','LowerLeg','Foot'].reduce((sum,joint)=>sum+(restPose[side+joint]?.position?.[1]||0),0)).map(Math.abs).filter(n=>n>.00001);
  const targetHeight=legHeights.length?Math.max(...legHeights):Math.abs(restHips[1]);
  const scale = sourceHeight > .00001 ? targetHeight/sourceHeight : 0;
  const tracks = [];
  const inverse = new THREE.Quaternion(), parent = new THREE.Quaternion(), q = new THREE.Quaternion();
  const position = new THREE.Vector3(), firstPosition = new THREE.Vector3();
  let rotations = 0;
  for (const track of source.tracks) {
    const dot = track.name.lastIndexOf('.');
    const nodeName = track.name.slice(0,dot), property = track.name.slice(dot+1);
    let boneName = reverse.get(nodeName);
    if (!boneName) continue;
    if (!vrm.humanoid.getNormalizedBoneNode('upperChest') && mapping.upperChest) {
      if (boneName === 'chest') continue;
      if (boneName === 'upperChest') boneName = 'chest';
    }
    const target = vrm.humanoid.getNormalizedBoneNode(boneName);
    const original = asset.getObjectByName(nodeName);
    if (!target || !original) continue;
    if ((!track.values.every(Number.isFinite)||!track.times.every(Number.isFinite))) throw new Error('动画关键帧含无效数值');
    original.getWorldQuaternion(inverse).invert();
    if (original.parent) original.parent.getWorldQuaternion(parent); else parent.identity();
    if (property === 'quaternion' && track instanceof THREE.QuaternionKeyframeTrack) {
      const values = track.values.slice();
      for (let i=0; i<values.length; i+=4) {
        q.fromArray(values,i).premultiply(parent).multiply(inverse).normalize().toArray(values,i);
        if (vrm.meta.metaVersion === '0') { values[i] *= -1; values[i+2] *= -1; }
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${target.name}.quaternion`,track.times,values,track.getInterpolation()));
      rotations++;
    } else if (property === 'position' && boneName === 'hips' && scale) {
      const values = track.values.slice();
      firstPosition.fromArray(values);
      if (original.parent) firstPosition.applyMatrix4(original.parent.matrixWorld);
      for (let i=0; i<values.length; i+=3) {
        position.fromArray(track.values,i);
        if (original.parent) position.applyMatrix4(original.parent.matrixWorld);
        const sign = vrm.meta.metaVersion === '0' ? -1 : 1;
        values[i] = restHips[0]+(inPlace?0:(position.x-firstPosition.x)*scale*sign);
        values[i+1] = restHips[1]+(position.y-hipPosition.y)*scale;
        values[i+2] = restHips[2]+(inPlace?0:(position.z-firstPosition.z)*scale*sign);
      }
      tracks.push(new THREE.VectorKeyframeTrack(`${target.name}.position`,track.times,values,track.getInterpolation()));
    }
  }
  if (!rotations) throw new Error('没有可播放的人形旋转轨道，请展开骨骼映射并指定对应关系');
  return new THREE.AnimationClip(source.name || 'FBX 动作',source.duration,tracks);
}
export async function loadDance(url,vrm) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('FBX 文件读取失败');
  const asset = parseFBX(await response.arrayBuffer());
  try { return retargetClip(asset,vrm); } finally { disposeFBX(asset); }
}
