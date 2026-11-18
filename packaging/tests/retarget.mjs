import assert from 'node:assert/strict';
import * as THREE from 'three';
import { retargetClip, suggestMapping } from '../backend/web/src/retarget.js';

const asset=new THREE.Group();
const pelvis=new THREE.Bone();pelvis.name='CustomPelvis';pelvis.position.y=100;asset.add(pelvis);
const head=new THREE.Bone();head.name='CustomHead';head.position.y=50;pelvis.add(head);
const foot=new THREE.Bone();foot.name='CustomFoot';foot.position.y=-100;pelvis.add(foot);
const targetHead=new THREE.Bone();targetHead.name='NormalizedHead';
const targetHips=new THREE.Bone();targetHips.name='NormalizedHips';
const vrm={meta:{metaVersion:'1'},humanoid:{normalizedRestPose:{hips:{position:[0,1,0]}},getNormalizedBoneNode:n=>({head:targetHead,hips:targetHips})[n]}};
const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI/2).toArray();
asset.animations=[new THREE.AnimationClip('First',1,[new THREE.QuaternionKeyframeTrack('CustomHead.quaternion',[0,1],[0,0,0,1,...q])]),new THREE.AnimationClip('Second',2,[new THREE.QuaternionKeyframeTrack('CustomHead.quaternion',[0,2],[0,0,0,1,...q]),new THREE.VectorKeyframeTrack('CustomPelvis.position',[0,2],[30,100,50,50,150,70])])];
const mapping={hips:'CustomPelvis',head:'CustomHead',leftFoot:'CustomFoot'};
let clip=retargetClip(asset,vrm,1,mapping);
assert.equal(clip.name,'Second');assert.equal(clip.duration,2);assert.equal(clip.tracks.length,2);
assert.deepEqual([...clip.tracks[1].values].map(n=>Number(n.toFixed(4))),[0,1,0,.2,1.5,.2]);
assert.deepEqual([...clip.tracks[0].values].slice(0,4),[0,0,0,1]);
assert.throws(()=>retargetClip(asset,vrm,0,{}),/旋转轨道/);
assert.throws(()=>retargetClip(asset,vrm,1,{head:'CustomHead',hips:'CustomHead'}),/重复/);
assert.throws(()=>retargetClip(asset,vrm,8,mapping),/片段/);
vrm.meta.metaVersion='0';clip=retargetClip(asset,vrm,1,mapping);
assert.equal(Number(clip.tracks[1].values[3].toFixed(2)),-.2);
head.name='Character:mixamorigHead';pelvis.name='pelvis';foot.name='foot_l';
assert.deepEqual(suggestMapping(asset),{hips:'pelvis',head:'Character:mixamorigHead',leftFoot:'foot_l'});
// A rotated source rest pose must become identity at its resting keyframe.
head.name='CustomHead';pelvis.name='CustomPelvis';head.quaternion.setFromAxisAngle(new THREE.Vector3(1,0,0),.7);
asset.animations=[new THREE.AnimationClip('Rest',1,[new THREE.QuaternionKeyframeTrack('CustomHead.quaternion',[0,1],[...head.quaternion.toArray(),...head.quaternion.toArray()])])];
clip=retargetClip(asset,vrm,0,{head:'CustomHead'});
assert(Math.abs(clip.tracks[0].values[0])<1e-6);assert(Math.abs(clip.tracks[0].values[3]-1)<1e-6);
console.log('Retarget tests passed: arbitrary names, multiple clips, scale, VRM0/1, rest rotation, invalid mapping.');

// Origins above/below the floor must not change limb scale or lose root offsets.
vrm.meta.metaVersion='1';
vrm.humanoid.normalizedRestPose={hips:{position:[3,-2,4]},leftUpperLeg:{position:[0,-.1,0]},leftLowerLeg:{position:[0,-.4,0]},leftFoot:{position:[0,-.5,0]}};
asset.animations=[new THREE.AnimationClip('OffsetOrigin',2,[new THREE.QuaternionKeyframeTrack('CustomHead.quaternion',[0,2],[0,0,0,1,0,0,0,1]),new THREE.VectorKeyframeTrack('CustomPelvis.position',[0,2],[0,100,0,50,150,50])])];
foot.name='CustomFoot';
clip=retargetClip(asset,vrm,0,mapping,{inPlace:true});
assert.deepEqual([...clip.tracks[1].values],[3,-2,4,3,-1.5,4]);
console.log('Offset origins and in-place motion passed.');
