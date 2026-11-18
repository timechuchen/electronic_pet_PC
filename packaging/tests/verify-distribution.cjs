const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const asar=require('@electron/asar');
const root=path.resolve(__dirname,'..');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
(async()=>{
 const version=JSON.parse(fs.readFileSync(path.join(root,'shell/package.json'))).version;
 const result={version,platforms:{}};
 const backendFiles=['app.py','pet/assets.py','pet/controller.py','web/app.js','web/index.html','web/chat.html','web/chat-ui.js','web/tracking-worker.js','web/tracking/face_landmarker.task','web/tracking/pose_landmarker_lite.task','web/audio/yamnet.tflite','web/audio-worker.js','Material/兰洛.vrm','Material/Hip Hop Dancing.fbx'];
 for(const platform of ['darwin-arm64','win32-x64']){
  const base=path.join(root,'build',`Lanluo-${platform}`),resource=platform.startsWith('darwin')?path.join(base,'Lanluo.app/Contents/Resources'):path.join(base,'resources');
  const archive=path.join(resource,'app.asar');
  assert.equal(JSON.parse(asar.extractFile(archive,'package.json')).version,version);
  for(const name of ['main.cjs','preload.cjs','chat-service.cjs','board-bridge.cjs','board-audio.cjs'])assert(asar.extractFile(archive,name).equals(fs.readFileSync(path.join(root,'shell',name))));
  for(const name of backendFiles)assert.equal(hash(path.join(resource,'backend',name)),hash(path.join(root,'backend',name)),`${platform}: ${name}`);
  for(const name of ['serial_worker.py','serial/__init__.py','serial/serialwin32.py','serial/tools/list_ports_windows.py','pyserial-3.5.dist-info/LICENSE.txt'])assert.equal(hash(path.join(resource,'board_runtime',name)),hash(path.join(root,'board_runtime',name)),platform+': '+name);
  assert(!fs.existsSync(path.join(resource,'backend/data')));
  const entries=asar.listPackage(archive);assert(!entries.some(name=>/ai-settings|ai-history|test-data/.test(name)));
  result.platforms[platform]={version,backendFilesMatched:backendFiles.length,shellFilesMatched:5,noUserData:true,asarFiles:entries.length};
 }
 const {load}=require('resedit/cjs'),edit=await load();
 const bytes=fs.readFileSync(path.join(root,'build/Lanluo-win32-x64/Lanluo.exe'));
 const exe=edit.NtExecutable.from(bytes),res=edit.NtExecutableResource.from(exe);
 const info=edit.Resource.VersionInfo.fromEntries(res.entries)[0];
 const strings=info.getStringValues(info.getAllLanguagesForStringValues()[0]);
 assert.equal(strings.FileVersion,version);assert.equal(strings.ProductName,'兰洛桌宠');
 result.platforms['win32-x64'].metadata={fileVersion:strings.FileVersion,productName:strings.ProductName,description:strings.FileDescription};
 fs.writeFileSync(path.join(root,`test-data/distribution-${version}.json`),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
})().catch(error=>{console.error(error);process.exitCode=1;});
