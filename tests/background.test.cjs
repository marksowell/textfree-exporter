const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function downloader(options={}){
  let listener,requests=[],permissions=[],injections=[];
  const ctx=vm.createContext({URL,AbortController,Uint8Array,btoa,setTimeout,clearTimeout,
    importScripts(file){vm.runInContext(fs.readFileSync(require.resolve('../'+file),'utf8'),ctx);},
    chrome:{permissions:{contains:async request=>{permissions.push(request);return options.allowed!==false;}},
      scripting:{executeScript:async config=>{injections.push(config);if(options.scriptError)throw new Error(options.scriptError);return options.execute?options.execute(config):[{frameId:0,result:options.captureResult||{ok:true,url:options.link}}];}},
      runtime:{onMessage:{addListener(f){listener=f;}}}},
    fetch:async(url,config)=>{requests.push({url,config});return new Response(options.bytes||new Uint8Array([1,2,3]),{headers:{'content-type':options.type||'image/jpeg'}});}});
  vm.runInContext(fs.readFileSync(require.resolve('../background.js'),'utf8'),ctx);
  const send=(message,sender={tab:{id:1},frameId:0,url:'https://messages.textfree.us/conversation/1'})=>new Promise(resolve=>listener(message,sender,resolve));
  return {requests,permissions,injections,send,run:(url,sender)=>send({type:'TF_EXPORT_MEDIA',url},sender)};
}
test('media downloader accepts only the observed TextFree attachment host and path',async()=>{
  const d=downloader();
  for(const url of ['https://example.org/photo.jpg','http://pingerprod01usw2-pb-mmspics.s3.amazonaws.com/communications/1/a.jpg','https://pingerprod01usw2-pb-mmspics.s3.amazonaws.com/other/a.jpg','https://127.0.0.1/private'])assert.equal((await d.run(url)).ok,false);
  assert.equal(d.requests.length,0);
});
test('media GET omits credentials, rejects redirects, and returns local bytes',async()=>{
  const d=downloader(),r=await d.run('https://pingerprod01usw2-pb-mmspics.s3.amazonaws.com/communications/1/a.jpg');assert.equal(r.ok,true);assert.equal(r.base64,'AQID');assert.equal(d.requests[0].config.credentials,'omit');assert.equal(d.requests[0].config.redirect,'error');assert.equal(d.requests[0].config.method,'GET');
});
test('media downloader refuses missing permission and active document formats',async()=>{
  const url='https://pingerprod01usw2-pb-mmspics.s3.amazonaws.com/communications/1/a.jpg';const denied=downloader({allowed:false});assert.equal((await denied.run(url)).ok,false);assert.equal(denied.requests.length,0);for(const type of ['text/html','image/svg+xml'])assert.equal((await downloader({type}).run(url)).ok,false);
});

const voiceUrl='https://pinger-prod-vmmessages.s3.amazonaws.com/vmmessages/123/2026/synthetic.wav';
const wav=Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x40\x1f\x00\x00\x80\x3e\x00\x00\x02\x00\x10\x00data\x00\x00\x00\x00','binary');
const voiceRequest={type:'TF_EXPORT_VOICEMAIL',pageUrl:'https://messages.textfree.us/conversation/1',ordinal:0,expected:{duration:'0:12',time:'9:00 AM',transcript:'Test'}};
test('voicemail WAV downloads accept common content types and require the matching host permission',async()=>{
  for(const type of ['audio/wav','audio/x-wav','application/octet-stream']){
    const d=downloader({type,bytes:wav});const result=await d.run(voiceUrl);assert.equal(result.ok,true);assert.equal(result.type,'audio/wav');assert.deepEqual(Buffer.from(result.base64,'base64'),wav);assert.equal(d.permissions[0].origins[0],'https://pinger-prod-vmmessages.s3.amazonaws.com/*');
  }
  assert.equal((await downloader({type:'audio/wav'}).run(voiceUrl)).ok,false);
});
test('voicemail requests reject unexpected hosts, ports, paths, credentials, and senders',async()=>{
  const d=downloader({type:'audio/wav',bytes:wav});
  for(const url of ['https://pinger-prod-vmmessages.s3.amazonaws.com/other/test.wav','https://pinger-prod-vmmessages.s3.amazonaws.com.evil.example/vmmessages/a.wav','https://pinger-prod-vmmessages.s3.amazonaws.com:8443/vmmessages/a.wav','https://user:pass@pinger-prod-vmmessages.s3.amazonaws.com/vmmessages/a.wav'])assert.equal((await d.run(url)).ok,false);
  assert.equal((await d.run(voiceUrl,{tab:{id:1},url:'https://evil.example/'})).ok,false);assert.equal(d.requests.length,0);
});
test('voicemail capture invokes only the sender top frame in MAIN and validates the returned link',async()=>{
  const d=downloader({link:voiceUrl});const result=await d.send(voiceRequest);assert.equal(result.ok,true);assert.equal(result.url,voiceUrl);assert.equal(d.injections[0].world,'MAIN');assert.equal(d.injections[0].target.tabId,1);assert.equal(d.injections[0].target.frameIds.length,1);assert.equal(d.injections[0].target.frameIds[0],0);assert.equal(d.injections[0].args[0].expected.transcript,'Test');assert.equal(typeof d.injections[0].func,'function');assert.equal(d.requests.length,0);
  assert.equal((await downloader({link:'https://example.org/test.wav'}).send(voiceRequest)).ok,false);
  assert.equal((await downloader({scriptError:'No link'}).send(voiceRequest)).ok,false);
});
test('invalid or unpermitted voicemail requests never click the page',async()=>{
  const d=downloader({link:voiceUrl});
  for(const message of [{...voiceRequest,pageUrl:'https://example.org/conversation/2'},{...voiceRequest,ordinal:-1},{...voiceRequest,expected:{}}])assert.equal((await d.send(message)).ok,false);
  assert.equal((await d.send(voiceRequest,{tab:{id:1},frameId:1,url:voiceRequest.pageUrl})).ok,false);assert.equal(d.injections.length,0);
  const denied=downloader({allowed:false});assert.equal((await denied.send(voiceRequest)).ok,false);assert.equal(denied.injections.length,0);
});

test('same-origin SPA navigation accepts a stale Chrome sender URL and preserves capture errors',async()=>{
  const d=downloader({link:voiceUrl});
  const result=await d.send({...voiceRequest,pageUrl:'https://messages.textfree.us/conversation/2'});
  assert.equal(result.ok,true);assert.equal(d.injections[0].args[0].pageUrl,'https://messages.textfree.us/conversation/2');
  const failure=await downloader({captureResult:{ok:false,error:'Voicemail Play button is unavailable'}}).send(voiceRequest);
  assert.equal(failure.ok,false);assert.equal(failure.error,'Voicemail Play button is unavailable');
});
test('real serialized capture works after SPA navigation but refuses a wrong current page',async()=>{
  const {parseHTML}=require('linkedom');
  const pageUrl='https://messages.textfree.us/conversation/2';
  const {document}=parseHTML('<html><body><communications-detail-page><div class="messages-container"><sc-voice-mail-message><button data-testid="voicemail-msg-bubble"><span class="voicemail-time">0:12</span></button><span class="message-time">9:00 AM</span><div class="voicemail-transcription-text">Test</div></sc-voice-mail-message></div></communications-detail-page></body></html>');
  let clicks=0;
  const originalOpen=()=>assert.fail('No popup should open during capture');
  const window={open:originalOpen};
  const page=vm.createContext({document,window,location:{origin:'https://messages.textfree.us',href:pageUrl}});
  document.querySelector('button').addEventListener('click',()=>{clicks++;window.open(voiceUrl);});
  const d=downloader({execute:config=>[{frameId:0,result:vm.runInContext('('+config.func.toString()+')('+JSON.stringify(config.args[0])+')',page)}]});
  const success=await d.send({...voiceRequest,pageUrl});
  assert.equal(success.ok,true);assert.equal(success.url,voiceUrl);assert.equal(clicks,1);assert.equal(window.open,originalOpen);
  const failure=await d.send(voiceRequest);
  assert.equal(failure.ok,false);assert.match(failure.error,/Conversation changed/);assert.equal(clicks,1);
});
