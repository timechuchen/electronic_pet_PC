/** Camera lifecycle + bounded off-main-thread inference. Never records or uploads. */
export class CameraCapture {
  constructor(video, callbacks) {
    this.video=video;this.callbacks=callbacks;this.phase='idle';this.generation=0;
    this.result=null;this.resultAt=0;this.lastFrame=0;this.lastVideoTime=-1;this.inFlight=false;
    this.onHidden=()=>{if(document.hidden&&this.phase!=='idle')this.stop();};
    document.addEventListener('visibilitychange',this.onHidden);
  }
  notify(phase,message) {this.phase=phase;this.callbacks.status(phase,message);}
  async start(deviceId='') {
    if(this.phase==='loading'||this.phase==='active')return;
    const generation=++this.generation;
    this.notify('loading','等待摄像头授权…');
    try {
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('当前环境不支持摄像头，请在 Chrome 中打开本地地址。');
      const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{width:{ideal:640},height:{ideal:480},frameRate:{ideal:24,max:30},...(deviceId?{deviceId:{exact:deviceId}}:{facingMode:'user'})}});
      if(generation!==this.generation){stream.getTracks().forEach(track=>track.stop());return;}
      this.stream=stream;
      stream.getVideoTracks()[0].addEventListener('ended',()=>{if(generation===this.generation)this.fail('摄像头已断开，请重新连接后开启。');});
      this.video.srcObject=stream;await this.video.play();
      if(generation!==this.generation)return;
      this.notify('loading','正在加载本地识别模型…');
      this.worker=new Worker('/tracking-worker.js');
      this.timeout=setTimeout(()=>this.fail('识别模型启动超时，请关闭后重试。'),60000);
      this.worker.onerror=()=>{if(generation===this.generation)this.fail('识别引擎启动失败，请使用最新版 Chrome 或 Edge。');};
      this.worker.onmessage=({data})=>{
        if(generation!==this.generation)return;
        if(data.type==='error'){this.fail(data.message);return;}
        if(data.type==='ready'){
          clearTimeout(this.timeout);this.notify('active','请让头部、肩膀和双手进入画面');
          this.lastVideoTime=-1;this.lastFrame=0;this.schedule(generation);
        } else if(data.type==='result'){
          clearTimeout(this.frameTimeout);this.inFlight=false;
          this.result=data;this.resultAt=performance.now();this.callbacks.result(data);
        }
      };
      this.worker.postMessage({type:'init'});
      navigator.mediaDevices.enumerateDevices().then(devices=>{if(generation===this.generation)this.callbacks.devices(devices.filter(d=>d.kind==='videoinput'));}).catch(()=>{});
    } catch(error) {
      if(generation!==this.generation)return;
      const messages={NotAllowedError:'摄像头权限未开启。请在地址栏允许摄像头后重试。',NotFoundError:'没有找到摄像头，请连接摄像头后重试。',NotReadableError:'摄像头被其他程序占用，请关闭占用它的程序后重试。',OverconstrainedError:'所选摄像头不可用，请选择其他摄像头。'};
      this.fail(messages[error.name] || error.message);
    }
  }
  schedule(generation) {
    if(generation!==this.generation||this.phase!=='active')return;
    this.timer=setTimeout(()=>this.schedule(generation),30);
    const now=performance.now();
    if(this.inFlight||this.video.readyState<2||now-this.lastFrame<65||this.video.currentTime===this.lastVideoTime)return;
    this.inFlight=true;this.lastFrame=now;this.lastVideoTime=this.video.currentTime;
    createImageBitmap(this.video,{resizeWidth:640,resizeQuality:'low'}).then(bitmap=>{
      if(generation!==this.generation){bitmap.close();return;}
      this.frameTimeout=setTimeout(()=>this.fail('动作识别没有响应，请重新开启摄像头。'),15000);
      this.worker.postMessage({type:'frame',bitmap,timestamp:now},[bitmap]);
    }).catch(error=>{if(generation===this.generation)this.fail(`无法读取摄像头画面：${error.message}`);});
  }
  stop() {
    ++this.generation;clearTimeout(this.timer);clearTimeout(this.timeout);clearTimeout(this.frameTimeout);
    this.worker?.terminate();this.worker=null;
    this.stream?.getTracks().forEach(track=>track.stop());this.stream=null;
    this.video.pause();this.video.srcObject=null;this.result=null;this.resultAt=0;this.inFlight=false;
    this.notify('idle','摄像头已关闭');
  }
  fail(message) {this.stop();this.notify('error',message);}
  dispose(){this.stop();document.removeEventListener('visibilitychange',this.onHidden);}
}
