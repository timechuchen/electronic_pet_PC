import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const params = new URLSearchParams(location.search);
const clean = params.get('clean') === '1';
if (clean) document.documentElement.style.setProperty('--clean', '1');
const $ = id => document.getElementById(id);
let vrm, scene, camera, renderer, height = 1.6, readyResolve;
const targets = new Map();
const euler = new THREE.Euler();
let localBones = {}, hipsRest = null;

function init() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.05, 100);
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  $('stage').appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xfffaf0, 0xb4c8c0, 2.3));
  const key = new THREE.DirectionalLight(0xfff9ed, 2.2); key.position.set(2, 4, 4); scene.add(key);
  const fill = new THREE.DirectionalLight(0xd5e7ff, 1); fill.position.set(-3, 2, -2); scene.add(fill);
  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
}
function look(framing = 1) {
  camera.position.set(0, height * .54, height * 2.25 * framing);
  camera.lookAt(0, height * .48, 0);
}
async function load() {
  const loader = new GLTFLoader();
  loader.register(p => new VRMLoaderPlugin(p));
  const gltf = await loader.loadAsync('/Material/%E5%85%B0%E6%B4%9B.vrm');
  vrm = gltf.userData.vrm;
  if (!vrm) throw new Error('not a VRM');
  VRMUtils.rotateVRM0(vrm);
  vrm.scene.traverse(o => o.frustumCulled = false);
  scene.add(vrm.scene);
  vrm.update(0);
  vrm.scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(vrm.scene);
  height = bounds.max.y - bounds.min.y;
  for (const [name, bone] of Object.entries(vrm.humanoid.normalizedHumanBones)) targets.set(name, bone.node);
  hipsRest = targets.get('hips')?.position.clone();
  look();
  renderer.render(scene, camera);
  if (params.get('t') != null) applyTime(Number(params.get('t')) || 0);
  else vrm.humanoid.resetNormalizedPose();
  readyResolve();
}
function restDirections() {
  vrm.humanoid.resetNormalizedPose(); vrm.update(0); vrm.scene.updateMatrixWorld(true);
  const out = {};
  for (const [name, node] of targets) {
    const child = node.children.find(c => c.isObject3D && [...targets.values()].includes(c));
    if (!child) continue;
    const a = node.getWorldPosition(new THREE.Vector3());
    const b = child.getWorldPosition(new THREE.Vector3());
    out[name] = b.sub(a).normalize().toArray().map(v => +v.toFixed(3));
  }
  return out;
}
function applyBones(bones = {}, root) {
  vrm.humanoid.resetNormalizedPose();
  localBones = bones || {};
  for (const [name, r] of Object.entries(localBones)) {
    const node = targets.get(name);
    if (node) node.quaternion.setFromEuler(euler.set(r[0], r[1], r[2]));
  }
  const hips = targets.get('hips');
  if (root && hips && hipsRest) hips.position.fromArray(root);
  vrm.update(0);
  vrm.scene.updateMatrixWorld(true);
  if (renderer && scene && camera) renderer.render(scene, camera);
}
let samples = null;
function applyTime(t) {
  if (!samples) return false;
  const frames = samples.frames;
  if (!frames.length) return false;
  const duration = samples.duration;
  t = ((t % duration) + duration) % duration;
  let hi = frames.findIndex(f => f.t >= t);
  if (hi < 0) hi = frames.length - 1;
  const b = frames[hi];
  applyBones(b.bones, b.root);
  $('t').textContent = t.toFixed(2);
  $('pose-name').textContent = b.label || '';
  renderer.render(scene, camera);
  return true;
}
async function loadSamples(url) {
  await window.poser.ready;
  samples = await (await fetch(url)).json();
  $('caption').hidden = false;
  return applyTime(Number(params.get('t')) || 0);
}
window.poser = {
  ready: new Promise(r => readyResolve = r),
  applyBones, applyTime, loadSamples,
  render: () => renderer.render(scene, camera),
  setView: (mode) => {
    if (mode === 'face') { camera.position.set(0, height * .84, height * .9); camera.lookAt(0, height * .8, 0); }
    else if (mode && typeof mode === 'object') {
      const { azimuth = 0, elevation = .05, distance = 2.3, target = .48 } = mode;
      const d = height * distance;
      camera.position.set(Math.sin(azimuth) * d * Math.cos(elevation), height * target + Math.sin(elevation) * d, Math.cos(azimuth) * d * Math.cos(elevation));
      camera.lookAt(0, height * target, 0);
    } else look();
    renderer.render(scene, camera);
  },
  restDirections,
  get height() { return height; },
  get vrm() { return vrm; },
  bonePositions: () => Object.fromEntries([...targets].map(([n, b]) => [n, b.getWorldPosition(new THREE.Vector3()).toArray().map(v => +v.toFixed(3))])),
};
init();
load().then(() => { $('loading').hidden = true; }).catch(err => { console.error(err); $('loading').textContent = err.message; });
if (params.get('data')) loadSamples(params.get('data'));
if (clean) { $('caption').style.display='none'; document.body.style.background='#eef3ea'; }
let playing = params.get('play') === '1', playStart = null;
function playLoop(now) {
  requestAnimationFrame(playLoop);
  if (!playing || !samples || !vrm) return;
  if (playStart == null) playStart = now;
  applyTime(((now - playStart) / 1000) % samples.duration);
}
requestAnimationFrame(playLoop);
