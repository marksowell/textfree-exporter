const MEDIA_HOST = 'pingerprod01usw2-pb-mmspics.s3.amazonaws.com';
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(message?.type !== 'TF_EXPORT_MEDIA') return;
  (async()=>{
    if(!sender.tab || new URL(sender.url).origin !== 'https://messages.textfree.us') throw new Error('Unexpected sender');
    const url = new URL(message.url);
    if(url.protocol !== 'https:' || url.hostname !== MEDIA_HOST || !url.pathname.startsWith('/communications/') || url.username || url.password) throw new Error('Attachment host or path is not supported');
    const permitted=await chrome.permissions.contains({origins:[`https://${MEDIA_HOST}/*`]});
    if(!permitted) throw new Error('Attachment permission was not granted');
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),25000);
    try {
      const response=await fetch(url.href,{method:'GET',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal});
      if(!response.ok) throw new Error(`Attachment returned HTTP ${response.status}`);
      const type=(response.headers.get('content-type')||'application/octet-stream').split(';')[0];
      if(!/^(image\/|audio\/|video\/|application\/(pdf|octet-stream)$)/i.test(type) || /svg/i.test(type)) throw new Error(`Unsupported media type: ${type}`);
      const max=20*1024*1024;
      if(Number(response.headers.get('content-length'))>max) throw new Error('Attachment exceeds 20 MB per-file limit');
      const reader=response.body.getReader(),chunks=[];let total=0;
      for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>max){await reader.cancel();throw new Error('Attachment exceeds 20 MB per-file limit');}chunks.push(value);}
      const bytes=new Uint8Array(total);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}
      let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
      return {ok:true,type,base64:btoa(binary),size:total};
    } finally {clearTimeout(timer);}
  })().then(reply).catch(e=>reply({ok:false,error:e.message}));
  return true;
});
