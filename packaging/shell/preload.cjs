const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('lanluoDesktop',{
 send:message=>ipcRenderer.send('pet-action',message),
 reportAudio:sample=>ipcRenderer.send('audio-sample',sample),
 onAudioCommand:callback=>ipcRenderer.on('audio-command',(_event,command)=>callback(command)),
 audioReady:()=>ipcRenderer.send('audio-ready'),
 chat:request=>ipcRenderer.invoke('pet-chat',request),
 onChat:callback=>{const listener=(_event,state)=>callback(state);ipcRenderer.on('chat-state',listener);return()=>ipcRenderer.removeListener('chat-state',listener);},
 onSpeak:callback=>{const listener=(_event,message)=>callback(message);ipcRenderer.on('chat-speak',listener);return()=>ipcRenderer.removeListener('chat-speak',listener);},
});
