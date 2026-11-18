import assert from 'node:assert/strict';
import * as THREE from 'three';
import {PoseRig,faceExpressions} from '../web/src/pose-rig.js';
function fixture(){
  const scene=new THREE.Scene();scene.rotation.y=Math.PI;
  const names={};
  function bone(name,parent,pos){const node=new THREE.Object3D();node.name=name;node.position.fromArray(pos);(names[parent]?.node||scene).add(node);names[name]={node};}
  bone('hips',null,[0,1,0]);bone('chest','hips',[0,.4,0]);bone('head','chest',[0,.3,0]);
  for(const side of ['left','right']){const sign=side==='right'?1:-1;
    bone(`${side}UpperArm`,'chest',[sign*.2,.1,0]);bone(`${side}LowerArm`,`${side}UpperArm`,[sign*.3,0,0]);bone(`${side}Hand`,`${side}LowerArm`,[sign*.25,0,0]);
    bone(`${side}UpperLeg`,'hips',[sign*.1,0,0]);bone(`${side}LowerLeg`,`${side}UpperLeg`,[0,-.4,0]);bone(`${side}Foot`,`${side}LowerLeg`,[0,-.4,0]);
  }
  const vrm={scene,humanoid:{normalizedHumanBones:names,getNormalizedBoneNode:n=>names[n]?.node,resetNormalizedPose:()=>{for(const {node} of Object.values(names))node.quaternion.identity();}}};
  return {vrm,rig:new PoseRig(vrm),names};
}
const world=Array.from({length:33},()=>({x:0,y:0,z:0,visibility:0}));
function set(i,x,y,z=0){world[i]={x,y,z,visibility:1};}
set(11,.2,-.5);set(12,-.2,-.5);set(23,.15,0);set(24,-.15,0);
set(13,.25,-.2);set(15,.3,.1);set(14,-.3,-.85);set(16,-.4,-1.15);
function direction(vrm,a,b){vrm.scene.updateMatrixWorld(true);return vrm.humanoid.getNormalizedBoneNode(b).getWorldPosition(new THREE.Vector3()).sub(vrm.humanoid.getNormalizedBoneNode(a).getWorldPosition(new THREE.Vector3())).normalize();}
{
 const {vrm,rig}=fixture();rig.apply({world},{mirror:false});
 const expected=new THREE.Vector3(-.1,.35,0).normalize();
 assert.ok(direction(vrm,'rightUpperArm','rightLowerArm').dot(expected)>.999,'Raised arm must point at the measured elbow');
 assert.ok(direction(vrm,'leftUpperArm','leftLowerArm').y<-.9,'Other arm remains down');
}
{
 const {vrm,rig}=fixture();rig.apply({world},{mirror:true});
 assert.ok(direction(vrm,'leftUpperArm','leftLowerArm').y>.9,'Mirroring swaps the raised arm');
 assert.ok(direction(vrm,'rightUpperArm','rightLowerArm').y<-.9);
}
{
 const {vrm,rig,names}=fixture();const hidden=structuredClone(world);hidden[14].visibility=hidden[16].visibility=0;
 rig.apply({world:hidden},{mirror:false});assert.equal(names.rightUpperArm.node.quaternion.angleTo(new THREE.Quaternion()),0,'Occluded joints must not invent a pose');
 for(const {node} of Object.values(names))assert.ok(node.quaternion.toArray().every(Number.isFinite));
 rig.apply({world},{weight:0});
}
{
 const {rig,names}=fixture();const matrix=new THREE.Matrix4().identity().toArray();rig.apply({matrix});
 const turn=new THREE.Matrix4().makeRotationY(.4).toArray();rig.apply({matrix:turn},{mirror:false});
 assert.ok(names.head.node.quaternion.angleTo(new THREE.Quaternion())>.3,'Head follows rotation after neutral calibration');
 assert.equal(rig.calibrate(),true);
 rig.apply({matrix:turn},{mirror:false});assert.ok(names.head.node.quaternion.angleTo(new THREE.Quaternion())<.001);
}
{
 const blends=[{categoryName:'eyeBlinkLeft',score:1},{categoryName:'eyeBlinkRight',score:.1},{categoryName:'jawOpen',score:.5}];
 assert.equal(faceExpressions(blends,false).blinkLeft,1);assert.equal(faceExpressions(blends,true).blinkRight,1);assert.equal(faceExpressions(blends).aa,.7);assert.equal(faceExpressions(null),null);
}
console.log('PASS: VRM 0 coordinate mapping, raised/lowered arms, mirror side swap, occlusion, head calibration, blink and mouth mapping.');
