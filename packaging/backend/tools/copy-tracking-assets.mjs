import fs from 'node:fs';
// Match the WASM runtime to the version pinned in package-lock.json on every build.
fs.mkdirSync('web/tracking/wasm',{recursive:true});
for(const name of fs.readdirSync('node_modules/@mediapipe/tasks-vision/wasm')) {
  fs.copyFileSync(`node_modules/@mediapipe/tasks-vision/wasm/${name}`,`web/tracking/wasm/${name}`);
}
for(const name of ['pose_landmarker_lite.task','face_landmarker.task']) {
  if(!fs.existsSync(`web/tracking/${name}`))throw new Error(`缺少本地模型 ${name}，下载地址见 web/tracking/assets.json`);
}
