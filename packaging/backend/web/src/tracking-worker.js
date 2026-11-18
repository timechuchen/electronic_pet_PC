// Classic worker: MediaPipe's WASM loader uses importScripts.
import { FilesetResolver, PoseLandmarker, FaceLandmarker } from '@mediapipe/tasks-vision';
let pose, face;
self.onmessage = async ({data}) => {
  if (data.type === 'init') {
    try {
      const files = await FilesetResolver.forVisionTasks('/tracking/wasm');
      pose = await PoseLandmarker.createFromOptions(files, {
        baseOptions: {modelAssetPath:'/tracking/pose_landmarker_lite.task',delegate:'CPU'},
        runningMode:'VIDEO',numPoses:1,minPoseDetectionConfidence:.55,
        minPosePresenceConfidence:.55,minTrackingConfidence:.55,
      });
      face = await FaceLandmarker.createFromOptions(files, {
        baseOptions: {modelAssetPath:'/tracking/face_landmarker.task',delegate:'CPU'},
        runningMode:'VIDEO',numFaces:1,outputFaceBlendshapes:true,
        outputFacialTransformationMatrixes:true,minFaceDetectionConfidence:.5,
      });
      self.postMessage({type:'ready'});
    } catch(error) {self.postMessage({type:'error',message:`识别模型加载失败：${error.message}`});}
  } else if (data.type === 'frame') {
    const start = performance.now();
    try {
      const body = pose.detectForVideo(data.bitmap, data.timestamp);
      const facial = face.detectForVideo(data.bitmap, data.timestamp);
      self.postMessage({type:'result',landmarks:body.landmarks[0] || null,
        world:body.worldLandmarks[0] || null,
        blends:facial.faceBlendshapes[0]?.categories || null,
        matrix:facial.facialTransformationMatrixes[0]?.data || null,
        ms:performance.now()-start});
    } catch(error) {self.postMessage({type:'error',message:`动作识别中断：${error.message}`});}
    finally {data.bitmap.close();}
  }
};
