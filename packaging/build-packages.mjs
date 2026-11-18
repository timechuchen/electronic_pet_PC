import packager from '@electron/packager';
import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
const root=process.cwd();const target=process.argv[2]||'darwin';
if(!['darwin','win32'].includes(target))throw new Error('Target must be darwin or win32');
const version=JSON.parse(fs.readFileSync(path.join(root,'shell/package.json'),'utf8')).version;
const arch=target==='darwin'?'arm64':'x64';
const stage=path.join(root,'staging',`${target}-${arch}`);fs.mkdirSync(stage,{recursive:true});
const outBackend=path.join(stage,'backend');fs.rmSync(outBackend,{recursive:true,force:true});fs.mkdirSync(outBackend,{recursive:true});
for(const name of ['app.py','pet','presets.example.json','THIRD_PARTY_LICENSES.txt'])fs.cpSync(path.join(root,'backend',name),path.join(outBackend,name),{recursive:true,filter:source=>!source.includes('__pycache__')});
fs.cpSync(path.join(root,'backend','web'),path.join(outBackend,'web'),{recursive:true,filter:source=>!source.includes(`${path.sep}src`)});
fs.mkdirSync(path.join(outBackend,'Material'));for(const name of ['兰洛.vrm','Hip Hop Dancing.fbx'])fs.copyFileSync(path.join(root,'backend','Material',name),path.join(outBackend,'Material',name));
if(target==='darwin')fs.cpSync(path.join(root,'backend','native','兰洛桌宠.app'),path.join(outBackend,'native','兰洛桌宠.app'),{recursive:true});
const outPython=path.join(stage,'python');fs.rmSync(outPython,{recursive:true,force:true});fs.cpSync(path.join(root,'runtimes',target==='darwin'?'macos-arm64':'windows-x64','python'),outPython,{recursive:true,verbatimSymlinks:true});
const zipDir=path.join(root,'downloads/electron-zips');const localZip=path.join(zipDir,`electron-v45.3.0-${target}-${arch}.zip`);
const zipOptions=fs.existsSync(localZip)?{electronZipDir:zipDir}:{download:{cacheRoot:path.join(root,'downloads/electron-cache')}};
const paths=await packager({dir:path.join(root,'shell'),out:path.join(root,'build'),platform:target,arch,electronVersion:'45.3.0',name:'Lanluo',appBundleId:'local.lanluo.standalone',appVersion:version,buildVersion:version,overwrite:true,asar:true,prune:false,icon:path.join(root,'shell',target==='darwin'?'icon.icns':'icon.ico'),extraResource:[outBackend,outPython,path.join(root,'board_runtime')],extendInfo:{CFBundleDisplayName:'兰洛桌宠',LSApplicationCategoryType:'public.app-category.utilities',NSCameraUsageDescription:'允许兰洛在本机识别你的动作并模仿，不录制或上传画面。',NSMicrophoneUsageDescription:'音乐跟随只读取系统播放声音，不使用麦克风。',NSAudioCaptureUsageDescription:'在本机识别系统播放的音乐，让兰洛自动跳舞。',NSScreenCaptureUsageDescription:'仅获取系统音频用于音乐识别，不保存屏幕图像。',LSMinimumSystemVersion:'13.0',LSUIElement:true},win32metadata:{CompanyName:'Lanluo',FileDescription:'Lanluo Desktop Pet',OriginalFilename:'Lanluo.exe',ProductName:'兰洛桌宠'},...zipOptions});
for(const directory of paths){
 if(target==='darwin'){
  const bundle=path.join(directory,'Lanluo.app');
  for(const name of ['LICENSE','LICENSES.chromium.html'])fs.copyFileSync(path.join(directory,name),path.join(bundle,'Contents','Resources',name));
  execFileSync('codesign',['--force','--deep','--sign','-',bundle],{stdio:'inherit'});
  execFileSync('codesign',['--verify','--deep','--strict',bundle],{stdio:'inherit'});
 }
 console.log(`PACKAGE_READY ${directory}`);
}
