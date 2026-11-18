class LocalSamples extends AudioWorkletProcessor {
 constructor(){super();this.buffer=new Float32Array(16000);this.offset=0;}
 process(inputs,outputs){
  const channels=inputs[0];if(channels?.length){for(let i=0;i<channels[0].length;i++){let sample=0;for(const c of channels)sample+=c[i];this.buffer[this.offset++]=sample/channels.length;if(this.offset===16000){const block=this.buffer;this.port.postMessage(block,[block.buffer]);this.buffer=new Float32Array(16000);this.offset=0;}}}
  // Output silence: analysis must never replay the captured system audio.
  for(const output of outputs)for(const channel of output)channel.fill(0);return true;
 }
}
registerProcessor('local-samples',LocalSamples);
