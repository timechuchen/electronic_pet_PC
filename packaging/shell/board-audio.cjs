'use strict';
const path=require('node:path');
// Read RIFF chunks instead of assuming every WAV has a 44-byte header.
function pcmFromWave(buffer){
 if(buffer.length<12||buffer.toString('ascii',0,4)!=='RIFF'||buffer.toString('ascii',8,12)!=='WAVE')throw Error('语音文件不是 WAV');
 const end=buffer.readUInt32LE(4)+8;if(end>buffer.length)throw Error('语音文件不完整');
 let format,data;
 for(let at=12;at+8<=end;){
  const tag=buffer.toString('ascii',at,at+4),length=buffer.readUInt32LE(at+4),start=at+8;
  if(start+length>end)throw Error('语音数据块不完整');
  if(tag==='fmt '){if(length<16)throw Error('语音格式缺失');format={encoding:buffer.readUInt16LE(start),channels:buffer.readUInt16LE(start+2),rate:buffer.readUInt32LE(start+4),bits:buffer.readUInt16LE(start+14)};}
  if(tag==='data')data=buffer.subarray(start,start+length);
  at=start+length+(length%2);
 }
 if(!format||format.encoding!==1||format.channels!==1||format.rate!==16000||format.bits!==16)throw Error('语音必须为 16 kHz 单声道 16 位 PCM');
 if(!data?.length||data.length%2||data.length>4*1024*1024)throw Error('语音长度无效或过长');
 return data;
}
const WINDOWS_SPEECH=`$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Speech
$speaker=New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
 $voice=$speaker.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like 'zh-*' } | Select-Object -First 1
 if (-not $voice) { throw 'No Chinese SAPI voice. Install a Chinese speech voice in Windows settings.' }
 $speaker.SelectVoice($voice.VoiceInfo.Name)
 $format=New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
 $speaker.SetOutputToWaveFile($env:LANLUO_TTS_WAVE,$format)
 $speaker.Speak([IO.File]::ReadAllText($env:LANLUO_TTS_TEXT,[Text.Encoding]::UTF8))
} finally { $speaker.Dispose() }
`;
function windowsSpeechCommand(temp,env=process.env){
 return {file:path.win32.join(env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),
  args:['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(WINDOWS_SPEECH,'utf16le').toString('base64')],
  env:{...env,LANLUO_TTS_TEXT:path.join(temp,'text.txt'),LANLUO_TTS_WAVE:path.join(temp,'voice.wav')}};
}
module.exports={pcmFromWave,windowsSpeechCommand};
