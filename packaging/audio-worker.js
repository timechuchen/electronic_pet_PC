import {AudioClassifier,FilesetResolver} from '@mediapipe/tasks-audio';
let classifier;
self.onmessage=async({data})=>{
 try{
  if(data.type==='init'){
   const files=await FilesetResolver.forAudioTasks('/audio/wasm');
   classifier=await AudioClassifier.createFromOptions(files,{baseOptions:{modelAssetPath:'/audio/yamnet.tflite'},maxResults:521});
   self.postMessage({type:'ready'});
  }else if(data.type==='samples'){
   const result=classifier.classify(data.samples,data.rate);
   const scores=result.flatMap(r=>r.classifications.flatMap(c=>c.categories)).filter(c=>c.categoryName==='Music').map(c=>c.score);
   let sum=0;for(const n of data.samples)sum+=n*n;
   self.postMessage({type:'result',score:scores.length?Math.max(...scores):0,level:Math.min(1,Math.sqrt(sum/data.samples.length))});
  }
 }catch(error){self.postMessage({type:'error',message:error.message});}
};
