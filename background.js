importScripts('voicemail.js');
const MEDIA_PATHS = new Map([
  ['pingerprod01usw2-pb-mmspics.s3.amazonaws.com', '/communications/'],
  ['pinger-prod-vmmessages.s3.amazonaws.com', '/vmmessages/']
]);
function mediaUrl(raw, voicemailOnly = false) {
  const url = new URL(raw);
  const prefix = MEDIA_PATHS.get(url.hostname);
  if(url.protocol !== 'https:' || url.port || !prefix || !url.pathname.startsWith(prefix) || url.username || url.password ||
     (voicemailOnly && url.hostname !== 'pinger-prod-vmmessages.s3.amazonaws.com')) throw new Error('Attachment host or path is not supported');
  return url;
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(!['TF_EXPORT_MEDIA','TF_EXPORT_VOICEMAIL'].includes(message?.type)) return;
  (async()=>{
    if(!sender.tab || (sender.frameId ?? 0) !== 0 || new URL(sender.url).origin !== 'https://messages.textfree.us') throw new Error('Unexpected sender');
    if(message.type === 'TF_EXPORT_VOICEMAIL') {
      // Chrome can retain the content script's original URL in sender.url after
      // TextFree navigates with pushState. Trust it for origin only; the injected
      // function checks the current location and record immediately before click.
      const requestedPage = new URL(message.pageUrl);
      if(requestedPage.origin !== 'https://messages.textfree.us' || !requestedPage.pathname.startsWith('/conversation/') ||
         requestedPage.username || requestedPage.password ||
         !Number.isSafeInteger(message.ordinal) || message.ordinal < 0 ||
         !['duration','time','transcript'].every(key => typeof message.expected?.[key] === 'string')) throw new Error('Invalid voicemail request');
      if(!await chrome.permissions.contains({origins:['https://pinger-prod-vmmessages.s3.amazonaws.com/*']})) throw new Error('Voicemail download permission was not granted');
      const results = await chrome.scripting.executeScript({
        target:{tabId:sender.tab.id,frameIds:[0]},world:'MAIN',func:captureVoicemailLink,
        args:[{pageUrl:message.pageUrl,ordinal:message.ordinal,expected:message.expected}]
      });
      const result = results.find(r => r.frameId === 0);
      if(!result?.result?.ok) throw new Error(result?.result?.error || 'TextFree did not return a voicemail capture result');
      return {ok:true,url:mediaUrl(result.result.url,true).href};
    }
    const url = mediaUrl(message.url);
    const permitted=await chrome.permissions.contains({origins:[`https://${url.hostname}/*`]});
    if(!permitted) throw new Error('Attachment permission was not granted');
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),25000);
    try {
      const response=await fetch(url.href,{method:'GET',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal});
      if(!response.ok) throw new Error(`Attachment returned HTTP ${response.status}`);
      let type=(response.headers.get('content-type')||'application/octet-stream').split(';')[0].trim().toLowerCase();
      if(!/^(image\/|audio\/|video\/|application\/(pdf|octet-stream)$)/i.test(type) || /svg/i.test(type)) throw new Error(`Unsupported media type: ${type}`);
      const max=20*1024*1024;
      if(Number(response.headers.get('content-length'))>max) throw new Error('Attachment exceeds 20 MB per-file limit');
      const reader=response.body.getReader(),chunks=[];let total=0;
      for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>max){await reader.cancel();throw new Error('Attachment exceeds 20 MB per-file limit');}chunks.push(value);}
      const bytes=new Uint8Array(total);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}
      if(url.hostname === 'pinger-prod-vmmessages.s3.amazonaws.com') {
        // S3 may serve WAV as audio/x-wav, audio/wave, or octet-stream.
        const tag = (start,end) => String.fromCharCode(...bytes.subarray(start,end));
        if(bytes.length < 12 || tag(0,4) !== 'RIFF' || tag(8,12) !== 'WAVE') throw new Error('Voicemail response is not a WAV recording');
        type='audio/wav';
      }
      let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
      return {ok:true,type,base64:btoa(binary),size:total};
    } finally {clearTimeout(timer);}
  })().then(reply).catch(e=>reply({ok:false,error:e.message}));
  return true;
});
