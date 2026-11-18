import * as THREE from 'three';
const clamp=THREE.MathUtils.clamp;
const valid=p=>p&&[p.x,p.y,p.z].every(Number.isFinite)&&(p.visibility??1)>.55;
const midpoint=(a,b)=>a.clone().add(b).multiplyScalar(.5);

/** Convert camera-space landmarks to this actual VRM's normalized bone axes. */
export class PoseRig {
  constructor(vrm) {
    this.vrm=vrm;this.reference=null;this.headReference=null;
    this.restWorld=new Map();this.axes=new Map();this.lastPose=null;this.lastMatrix=null;
    vrm.humanoid.resetNormalizedPose();vrm.scene.updateMatrixWorld(true);
    for(const [name,bone] of Object.entries(vrm.humanoid.normalizedHumanBones))this.restWorld.set(name,bone.node.getWorldQuaternion(new THREE.Quaternion()));
    const pairs=[['leftUpperArm','leftLowerArm'],['leftLowerArm','leftHand'],['rightUpperArm','rightLowerArm'],['rightLowerArm','rightHand'],['leftUpperLeg','leftLowerLeg'],['leftLowerLeg','leftFoot'],['rightUpperLeg','rightLowerLeg'],['rightLowerLeg','rightFoot']];
    for(const [name,child] of pairs){const a=this.node(name),b=this.node(child);if(a&&b)this.axes.set(name,b.getWorldPosition(new THREE.Vector3()).sub(a.getWorldPosition(new THREE.Vector3())).normalize().applyQuaternion(this.restWorld.get(name).clone().invert()));}
  }
  node(name){return this.vrm.humanoid.getNormalizedBoneNode(name);}
  resetCalibration(){this.reference=null;this.headReference=null;}
  calibrate(){
    if(this.lastPose)this.reference=this.lastPose.clone();
    if(this.lastMatrix)this.headReference=this.lastMatrix.clone();
    return !!(this.lastPose||this.lastMatrix);
  }
  orientWorld(name,delta) {
    const bone=this.node(name);if(!bone)return;
    bone.parent.updateWorldMatrix(true,false);
    const parent=bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    bone.quaternion.copy(parent.multiply(delta).multiply(this.restWorld.get(name)));
    bone.updateWorldMatrix(false,true);
  }
  aim(name,from,to) {
    const bone=this.node(name),axis=this.axes.get(name);if(!bone||!axis)return;
    const direction=to.clone().sub(from);if(direction.lengthSq()<1e-6)return;
    bone.parent.updateWorldMatrix(true,false);
    direction.normalize().applyQuaternion(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
    bone.quaternion.setFromUnitVectors(axis,direction);bone.updateWorldMatrix(false,true);
  }
  apply(result,{mirror=true,legs=false,weight=1}={}) {
    if(!result||weight<=0)return {body:false,face:false};
    const before=new Map();
    for(const [name,bone] of Object.entries(this.vrm.humanoid.normalizedHumanBones))before.set(name,bone.node.quaternion.clone());
    const lm=result.world;
    const point=i=>new THREE.Vector3(lm[i].x*(mirror?-1:1),-lm[i].y,-lm[i].z);
    const index=(left,right,side)=>side==='left'?(mirror?right:left):(mirror?left:right);
    let body=false;
    if(lm?.length>=33&&[11,12,23,24].every(i=>valid(lm[i]))) {
      body=true;
      const left=point(index(11,12,'left')),right=point(index(11,12,'right'));
      const up=midpoint(left,right).sub(midpoint(point(23),point(24))).normalize();
      const across=left.clone().sub(right).normalize();
      const forward=new THREE.Vector3().crossVectors(across,up).normalize();
      if(forward.lengthSq()>.5){
        const x=new THREE.Vector3().crossVectors(up,forward).normalize();
        const bodyQ=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,up,forward));
        this.lastPose=bodyQ.clone();
        const delta=this.reference?bodyQ.multiply(this.reference.clone().invert()):bodyQ;
        const angles=new THREE.Euler().setFromQuaternion(delta,'YXZ');
        angles.x=clamp(angles.x,-.55,.55);angles.y=clamp(angles.y,-.8,.8);angles.z=clamp(angles.z,-.55,.55);
        this.orientWorld('chest',new THREE.Quaternion().setFromEuler(angles));
      }
    }
    if(lm?.length>=33){
      for(const side of ['left','right']){
        const shoulder=index(11,12,side),elbow=index(13,14,side),wrist=index(15,16,side);
        if([shoulder,elbow].every(i=>valid(lm[i]))){this.aim(`${side}UpperArm`,point(shoulder),point(elbow));body=true;}
        if([shoulder,elbow,wrist].every(i=>valid(lm[i])))this.aim(`${side}LowerArm`,point(elbow),point(wrist));
        if(legs){const hip=index(23,24,side),knee=index(25,26,side),ankle=index(27,28,side);
          if([hip,knee,ankle].every(i=>valid(lm[i]))){this.aim(`${side}UpperLeg`,point(hip),point(knee));this.aim(`${side}LowerLeg`,point(knee),point(ankle));}
        }
      }
    }
    let face=false;
    if(result.matrix?.length===16&&result.matrix.every(Number.isFinite)){
      const matrix=new THREE.Matrix4().fromArray(result.matrix);
      const q=new THREE.Quaternion();matrix.decompose(new THREE.Vector3(),q,new THREE.Vector3());
      if(mirror){q.y=-q.y;q.z=-q.z;}
      this.lastMatrix=q.clone();
      if(!this.headReference)this.headReference=q.clone();
      const delta=q.multiply(this.headReference.clone().invert());
      const angles=new THREE.Euler().setFromQuaternion(delta,'YXZ');
      angles.x=clamp(angles.x,-.65,.65);angles.y=clamp(angles.y,-1,1);angles.z=clamp(angles.z,-.6,.6);
      this.orientWorld('head',new THREE.Quaternion().setFromEuler(angles));face=true;
    }
    // Loss-of-tracking fades to the baseline pose rather than freezing forever.
    for(const [name,bone] of Object.entries(this.vrm.humanoid.normalizedHumanBones))bone.node.quaternion.slerp(before.get(name),1-weight);
    return {body,face};
  }
}
export function faceExpressions(blends,mirror=true) {
  if(!blends)return null;
  const scores=Object.fromEntries(blends.map(b=>[b.categoryName,clamp(b.score,0,1)]));
  const left=scores.eyeBlinkLeft??0,right=scores.eyeBlinkRight??0;
  return {blink:0,blinkLeft:mirror?right:left,blinkRight:mirror?left:right,
    happy:clamp(((scores.mouthSmileLeft??0)+(scores.mouthSmileRight??0))*.65,0,.8),aa:clamp((scores.jawOpen??0)*1.4,0,1)};
}
