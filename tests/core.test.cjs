const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseHTML}=require('linkedom');
const fs=require('node:fs');
const vm=require('node:vm');
const C=require('../core.js');
const vmRecord='<sc-voice-mail-message><div class="bubble"><button class="received-message">New Voicemail <span class="voicemail-time">0:35</span></button><span class="message-time">9:03 AM</span><div class="voicemail-transcription-text">Please call back.</div></div></sc-voice-mail-message>';
const message='<sc-chat-bubble><div class="bubble user-bubble"><div class="text-item sent-message">Repeated message\nSecond line</div><span class="message-time">9:01 AM</span></div></sc-chat-bubble>';
function doc(body){return parseHTML(`<html><body><ion-list class="conversation-list"><ion-item class="conversation conversation-selected"><p class="contact">(555) 010-1111</p></ion-item></ion-list><communications-detail-page class="ion-page ion-page-hidden"><div class="messages-container">WRONG CHAT</div></communications-detail-page><communications-detail-page class="ion-page"><ion-content class="conversation-container"><ion-infinite-scroll class="hydrated"></ion-infinite-scroll><div class="messages-container"><span class="communication-date">September 21, 2026</span>${body}</div></ion-content></communications-detail-page></body></html>`).document;}
function archive(c){return {scope:'current',startedAt:'2026-09-21T12:00:00Z',inbox:{status:'not-requested'},conversations:[c],errors:[]};}
test('uses only active chat, preserves duplicates, multiline text, date and direction',()=>{
  const c=C.extract(doc(message+message),'https://messages.textfree.us/conversation/15550101111');
  assert.equal(c.records.length,2);assert.equal(c.records[0].direction,'outgoing');assert.equal(c.records[1].text,'Repeated message\nSecond line');assert.equal(c.records[1].date,'September 21, 2026');assert.ok(!JSON.stringify(c).includes('WRONG CHAT'));
});
test('refuses ambiguous active pages',()=>{const d=doc(message);d.querySelector('.ion-page-hidden').classList.remove('ion-page-hidden');assert.throws(()=>C.extract(d,'https://messages.textfree.us/conversation/1'),/exactly one/);});
test('captures calls and voicemail, explicitly flags missing audio',()=>{
  const c=C.extract(doc('<sc-chat-error-message errortype="missedCallExtendedMessage"><ion-label class="text-item">Missed Call</ion-label><span class="message-time">9:00 AM</span></sc-chat-error-message>'+vmRecord),'https://messages.textfree.us/conversation/1');
  assert.equal(c.records[0].kind,'call');assert.equal(c.records[0].direction,'incoming');assert.equal(c.records[1].transcript,'Please call back.');assert.equal(c.records[1].duration,'0:35');assert.match(c.records[1].warnings[0],/audio/);
});
test('captures attachment URLs but never treats message hyperlinks as media',()=>{
  const c=C.extract(doc('<sc-chat-bubble><div class="text-item received-message"><a href="https://example.org/bill">Bill</a></div><span class="message-time">9:00 AM</span></sc-chat-bubble><sc-image-message><img src="https://pingerprod01usw2-pb-mmspics.s3.amazonaws.com/communications/1/test.jpg"><span class="message-time">9:01 AM</span></sc-image-message>'),'https://messages.textfree.us/conversation/1');
  assert.equal(c.records[0].links.length,1);assert.equal(c.records[0].attachments.length,0);assert.equal(c.records[1].attachments[0].kind,'image');
});
test('email anchors survive extraction and render as mail links without becoming attachments',()=>{
  const c=C.extract(doc('<sc-chat-bubble><div class="text-item received-message">Email <a href="mailto:info@example.test">info@example.test</a>.</div></sc-chat-bubble>'),'https://messages.textfree.us/conversation/1');
  assert.deepEqual(c.records[0].links,[{text:'info@example.test',url:'mailto:info@example.test'}]);
  assert.equal(c.records[0].attachments.length,0);
  const {document}=parseHTML(C.render(archive(c)));
  assert.equal(document.querySelector('.message-text a').getAttribute('href'),'mailto:info@example.test');
});
test('unknown and unavailable components are retained and flagged',()=>{const c=C.extract(doc('<sc-new-message>Something new</sc-new-message><sc-video-message>Video unavailable</sc-video-message>'),'https://messages.textfree.us/conversation/1');assert.equal(c.records.length,2);assert.equal(c.records[0].kind,'unknown');assert.equal(c.records[1].warnings.length,1);});
test('archive HTML escapes user content and never embeds remote media',()=>{
  const c=C.extract(doc(message),'https://messages.textfree.us/conversation/1');c.contact='<script>alert(1)</script>';c.records[0].text='<img src=x onerror=alert(1)>';c.records[0].attachments=[{url:'https://evil.example/track',kind:'image',status:'failed',error:'No access'}];
  const html=C.render(archive(c));assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('src="https://'));assert.ok(html.includes("script-src 'none'"));
});
test('coverage report never claims server completeness and exposes pending files',()=>{const c=C.extract(doc(vmRecord),'https://messages.textfree.us/conversation/1');c.history={status:'exhausted'};c.records[0].attachments.push({status:'pending',url:'https://example.org/a'});const r=C.report(archive(c));assert.equal(r.serverCompletenessVerified,false);assert.equal(r.unsavedAttachments,1);assert.equal(r.conversationsNeedingReview.length,1);});
test('ZIP is valid, includes binary payload, and rejects unsafe filenames',async()=>{
  const child=require('node:child_process');
  const zip=C.zip([{name:'index.html',data:'Hello π'},{name:'attachments/000001.bin',data:new Uint8Array([0,255,7])}]);
  const result=child.spawnSync('python3',['-c','import io,sys,zipfile;z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));assert z.testzip() is None;assert z.read("index.html").decode()=="Hello π";assert z.read("attachments/000001.bin")==bytes([0,255,7])'],{input:Buffer.from(await zip.arrayBuffer()),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.throws(()=>C.zip([{name:'../escape',data:'bad'}]),/Unsafe/);
});
function simulation(mode='all',options={}){
  const {document,window}=parseHTML('<html><body><ion-content class="conversation-list-content"><ion-list class="conversation-list"><ion-item class="conversation conversation-selected"><p class="contact">A</p></ion-item></ion-list><ion-infinite-scroll class="hydrated infinite-scroll-enabled"></ion-infinite-scroll></ion-content><communications-detail-page><ion-content class="conversation-container"><ion-infinite-scroll class="hydrated infinite-scroll-enabled"></ion-infinite-scroll><div class="messages-container"><span class="communication-date">September 21, 2026</span>'+message+'</div></ion-content></communications-detail-page></body></html>');
  let clock=0,listener;const location={origin:'https://messages.textfree.us',pathname:'/conversation/1',get href(){return this.origin+this.pathname;}};
  const ctx={TFCore:C,document,location,console,URL,Blob,TextEncoder,Uint8Array,Event:window.Event,atob,btoa,Date:class extends Date{static now(){return clock;}},setTimeout:(f,ms)=>{clock+=ms;setImmediate(()=>{options.onTick?.({ctx,document,clock,ms});f();});return 1;},chrome:{runtime:{onMessage:{addListener(f){listener=f;}},sendMessage:options.sendMessage|| (async()=>({ok:false,error:'simulated inaccessible attachment'}))}}};
  for(const el of document.querySelectorAll('ion-content')){const s=el.attachShadow({mode:'open'});s.innerHTML='<div class="inner-scroll"></div>';}
  const list=document.querySelector('.conversation-list-content'),history=document.querySelector('.conversation-container');let events=0,opensB=0;
  list.shadowRoot.querySelector('.inner-scroll').addEventListener('scroll',()=>{
    if(events++)return;list.querySelector('ion-list').insertAdjacentHTML('beforeend','<ion-item class="conversation"><p class="contact">B</p></ion-item>');list.querySelector('ion-infinite-scroll').classList.remove('infinite-scroll-enabled');
    document.querySelectorAll('.contact')[1].addEventListener('click',()=>{
      opensB++;if(mode==='navigation-fails'||opensB<=(options.navigationFailures||0))return;
      document.querySelector('.conversation-selected').classList.remove('conversation-selected');document.querySelectorAll('.conversation')[1].classList.add('conversation-selected');location.pathname='/conversation/2';history.querySelector('.messages-container').innerHTML='<span class="communication-date">September 20, 2026</span>'+(options.bodyB?options.bodyB(opensB):vmRecord);history.querySelector('ion-infinite-scroll').classList.remove('infinite-scroll-enabled');
    });
  });
  history.shadowRoot.querySelector('.inner-scroll').addEventListener('scroll',()=>{
    if(mode==='stall')return;
    const infinite=history.querySelector('ion-infinite-scroll');
    if(infinite.classList.contains('infinite-scroll-enabled')){history.querySelector('.messages-container').insertAdjacentHTML('beforeend',message);infinite.classList.remove('infinite-scroll-enabled');}
    if(mode==='stop')ctx.TFRunner.stop=true;
  });
  options.setup?.({ctx,document,history,list,window});
  vm.runInNewContext(fs.readFileSync(require.resolve('../collector.js'),'utf8'),ctx);
  listener({type:'TF_EXPORT_START',scope:options.scope||(mode==='all'||mode==='navigation-fails'?'all':'current'),media:!!options.media},{},()=>{});
  return ctx;
}
async function finished(ctx){for(let i=0;i<1000&&ctx.TFRunner.running;i++)await new Promise(setImmediate);assert.equal(ctx.TFRunner.running,false);return ctx.TFRunner.archive;}
test('collector paginates inbox and history and retains repeated messages',async()=>{const a=await finished(simulation());assert.equal(a.inbox.status,'exhausted');assert.equal(a.inbox.discoveredConversations,2);assert.equal(a.conversations.length,2);assert.equal(a.conversations[0].records.length,2);assert.equal(a.conversations[0].history.status,'exhausted');assert.equal(a.conversations[1].id,'2');assert.equal(a.conversations[1].records[0].kind,'voicemail');});
test('pagination stalls are explicitly incomplete',async()=>{const a=await finished(simulation('stall'));assert.equal(a.conversations[0].history.status,'incomplete');assert.match(a.conversations[0].history.reason,/three attempts/);});
test('stop preserves the current capture and marks it incomplete',async()=>{const a=await finished(simulation('stop'));assert.equal(a.conversations[0].records.length,2);assert.equal(a.conversations[0].history.status,'incomplete');assert.match(a.errors[0],/Stopped/);});
test('navigation failure cannot archive the previous chat under a new label',async()=>{const a=await finished(simulation('navigation-fails'));assert.equal(a.conversations.length,2);assert.equal(a.conversations[1].records.length,0);assert.ok(a.conversations[1].error);assert.match(a.conversations[1].id,/unopened/);});

test('collector stores voicemail audio with its transcript and duration and renders local playback',async()=>{
  const calls=[];
  const ctx=simulation('all',{media:true,sendMessage:async message=>{calls.push(message);return message.type==='TF_EXPORT_VOICEMAIL'?{ok:true,url:'https://pinger-prod-vmmessages.s3.amazonaws.com/vmmessages/123/2026/test.wav'}:{ok:true,type:'audio/wav',size:3,base64:'AQID'};}});
  const a=await finished(ctx),r=a.conversations[1].records[0],report=C.report(a);
  assert.equal(calls[0].type,'TF_EXPORT_VOICEMAIL');assert.equal(calls[0].pageUrl,'https://messages.textfree.us/conversation/2');assert.equal(calls[0].ordinal,0);assert.equal(calls[0].expected.transcript,'Please call back.');
  assert.equal(r.transcript,'Please call back.');assert.equal(r.duration,'0:35');assert.equal(r.warnings.length,0);assert.equal(r.attachments[0].status,'saved');assert.equal(r.attachments[0].path,'attachments/000001.wav');assert.equal(report.savedVoicemailAudio,1);assert.equal(report.missingVoicemailAudio,0);assert.equal(report.conversationsNeedingReview.length,0);assert.deepEqual(Array.from(ctx.TFRunner.files[0].data),[1,2,3]);
  assert.match(C.render(a),/<audio controls preload="metadata" src="attachments\/000001.wav"><\/audio>/);assert.match(C.render(a),/<dt>Voicemail audio<\/dt><dd>1 of 1 saved<\/dd>/);
});
test('voicemail link or download failure retains text and counts a missing recording',async()=>{
  for(const stage of ['link','download']){
    const a=await finished(simulation('all',{media:true,sendMessage:async message=>message.type==='TF_EXPORT_VOICEMAIL'&&stage==='download'?{ok:true,url:'https://pinger-prod-vmmessages.s3.amazonaws.com/vmmessages/123/2026/test.wav'}:{ok:false,error:'Synthetic '+stage+' failure'}}));
    const r=a.conversations[1].records[0],report=C.report(a);assert.equal(r.transcript,'Please call back.');assert.equal(r.duration,'0:35');assert.equal(report.savedVoicemailAudio,0);assert.equal(report.missingVoicemailAudio,1);assert.equal(report.conversationsNeedingReview.length,1);assert.match(JSON.stringify(report),/Synthetic/);assert.equal(report.unsavedAttachments,stage==='download'?1:0);
  }
});
test('disabled media never requests voicemail links and explains missing audio',async()=>{
  let calls=0;const a=await finished(simulation('all',{sendMessage:async()=>{calls++;}}));assert.equal(calls,0);assert.equal(C.report(a).missingVoicemailAudio,1);assert.match(a.conversations[1].records[0].warnings[0],/disabled or permission/);
});

test('completion panel displays voicemail failure reasons without opening the JSON report',async()=>{
  const ctx=simulation('all',{media:true,sendMessage:async()=>({ok:false,error:'Invalid voicemail request'})});
  const a=await finished(ctx),report=C.report(a);
  assert.deepEqual(report.voicemailFailureReasons,[{reason:'Voicemail audio not saved: Invalid voicemail request',count:1}]);
  assert.match(ctx.TFRunner.status.textContent,/1 recording\(s\): Voicemail audio not saved: Invalid voicemail request/);
});

test('failed conversation navigation recovers on retry without repeating successful conversations',async()=>{
  const a=await finished(simulation('all',{navigationFailures:1}));
  assert.equal(a.conversations.length,2);
  assert.equal(a.conversations[0].captureAttempts,1);
  assert.equal(a.conversations[1].captureAttempts,2);
  assert.equal(a.conversations[1].id,'2');assert.equal(a.conversations[1].error,undefined);
  assert.equal(a.conversations[1].records[0].kind,'voicemail');
});

test('inbox loading retries before collecting conversations and clears recovered errors',async()=>{
  const ctx=simulation('all',{
    setup:({list})=>list.insertAdjacentHTML('beforeend','<ion-loading></ion-loading>'),
    onTick:({ctx,document})=>{if(ctx.TFRunner?.status.textContent.startsWith('Retrying inbox loading'))document.querySelector('.conversation-list-content ion-loading')?.remove();}
  });
  const a=await finished(ctx);
  assert.equal(a.inbox.captureAttempts,2);assert.equal(a.inbox.status,'exhausted');
  assert.equal(a.inbox.discoveredConversations,2);assert.equal(a.conversations.length,2);assert.equal(a.errors.length,0);
  assert.ok(a.conversations.every(c=>c.captureAttempts===1));
});

test('persistent inbox loading errors stop after three attempts and still capture available rows',async()=>{
  const a=await finished(simulation('all',{setup:({list})=>list.insertAdjacentHTML('beforeend','<ion-loading></ion-loading>')}));
  assert.equal(a.inbox.captureAttempts,3);assert.equal(a.inbox.status,'incomplete');
  assert.equal(a.conversations.length,1);assert.equal(a.conversations[0].records.length,2);
  assert.match(a.errors[0],/Inbox may be incomplete after three attempts/);
});

test('persistent navigation errors stop after three attempts and retain an explicit empty entry',async()=>{
  const ctx=simulation('navigation-fails'),a=await finished(ctx);
  assert.equal(a.conversations.length,2);assert.equal(a.conversations[0].captureAttempts,1);
  assert.equal(a.conversations[1].captureAttempts,3);assert.equal(a.conversations[1].records.length,0);
  assert.equal(C.report(a).conversationsNeedingReview[0].captureAttempts,3);
  assert.equal(ctx.TFRunner.retry.hidden,false);
});

test('ambiguous active pages are retried and cannot copy a hidden or wrong conversation',async()=>{
  const ctx=simulation('current',{setup:({document})=>{
    const duplicate=document.querySelector('communications-detail-page').cloneNode(true);
    duplicate.querySelector('.messages-container').textContent='WRONG CONVERSATION';document.body.append(duplicate);
    document.querySelector('.contact').addEventListener('click',()=>duplicate.remove());
  }});
  const a=await finished(ctx);
  assert.equal(a.conversations[0].captureAttempts,2);assert.equal(a.conversations[0].error,undefined);
  assert.ok(!JSON.stringify(a).includes('WRONG CONVERSATION'));assert.equal(a.conversations[0].records.length,2);
});

test('a history-loading timeout still saves visible voicemail and reuses it when the retry recovers',async()=>{
  let links=0,downloads=0;
  const ctx=simulation('stall',{media:true,setup:({document,history})=>{
    history.querySelector('.messages-container').innerHTML='<span class="communication-date">September 21, 2026</span>'+vmRecord;
    let recovered=false;
    history.shadowRoot.querySelector('.inner-scroll').addEventListener('scroll',()=>{if(!recovered&&!history.querySelector('ion-loading'))history.insertAdjacentHTML('beforeend','<ion-loading></ion-loading>');});
    document.querySelector('.contact').addEventListener('click',()=>{recovered=true;history.querySelector('ion-loading')?.remove();history.querySelector('ion-infinite-scroll').classList.remove('infinite-scroll-enabled');});
  },sendMessage:async message=>{
    if(message.type==='TF_EXPORT_VOICEMAIL'){links++;return {ok:true,url:'https://pinger-prod-vmmessages.s3.amazonaws.com/vmmessages/123/demo.wav'};}
    downloads++;return {ok:true,type:'audio/wav',size:3,base64:'AQID'};
  }});
  const a=await finished(ctx),c=a.conversations[0];
  assert.equal(c.captureAttempts,2);assert.equal(c.history.status,'exhausted');assert.equal(c.error,undefined);
  assert.equal(links,1);assert.equal(downloads,1);assert.equal(ctx.TFRunner.files.length,1);
  assert.equal(C.report(a).savedVoicemailAudio,1);assert.equal(C.report(a).conversationsNeedingReview.length,0);
});

test('voicemail Play-link failures get two additional attempts and clear recovered warnings',async()=>{
  let links=0,downloads=0;
  const ctx=simulation('all',{media:true,sendMessage:async message=>{
    if(message.type==='TF_EXPORT_VOICEMAIL')return ++links<3?{ok:false,error:'Recording link temporarily unavailable'}:{ok:true,url:'https://pinger-prod-vmmessages.s3.amazonaws.com/vmmessages/123/demo.wav'};
    downloads++;return {ok:true,type:'audio/wav',size:3,base64:'AQID'};
  }});
  const a=await finished(ctx);
  assert.equal(links,3);assert.equal(downloads,1);assert.equal(a.conversations[0].captureAttempts,1);assert.equal(a.conversations[1].captureAttempts,3);
  assert.equal(C.report(a).missingVoicemailAudio,0);assert.equal(C.report(a).conversationsNeedingReview.length,0);
  assert.equal(ctx.TFRunner.retry.hidden,true);
});

test('failed media downloads retry while saved voicemail files and duplicate messages are retained once',async()=>{
  let links=0,voiceDownloads=0,imageDownloads=0;
  const image='<sc-image-message><img src="https://pingerprod01usw2-pb-mmspics.s3.amazonaws.com/communications/123/demo.png"></sc-image-message>';
  const ctx=simulation('all',{media:true,bodyB:()=>vmRecord+message+message+image,sendMessage:async message=>{
    if(message.type==='TF_EXPORT_VOICEMAIL'){links++;return {ok:true,url:'https://pinger-prod-vmmessages.s3.amazonaws.com/vmmessages/123/demo.wav'};}
    if(message.url.endsWith('.png')){imageDownloads++;return imageDownloads===1?{ok:false,error:'Network request timed out'}:{ok:true,type:'image/png',size:3,base64:'BAUG'};}
    voiceDownloads++;return {ok:true,type:'audio/wav',size:3,base64:'AQID'};
  }});
  const a=await finished(ctx),c=a.conversations[1];
  assert.equal(c.captureAttempts,2);assert.equal(c.records.length,4);
  assert.equal(c.records.filter(r=>r.kind==='message').length,2);
  assert.equal(links,1);assert.equal(voiceDownloads,1);assert.equal(imageDownloads,2);
  assert.equal(ctx.TFRunner.files.length,2);assert.equal(ctx.TFRunner.bytes,6);
  assert.equal(c.records.at(-1).attachments[0].error,undefined);
  assert.equal(C.report(a).conversationsNeedingReview.length,0);
});

test('voicemail file-download failures reuse the captured URL on retry',async()=>{
  let links=0,downloads=0;
  const ctx=simulation('all',{media:true,sendMessage:async message=>{
    if(message.type==='TF_EXPORT_VOICEMAIL'){links++;return {ok:true,url:'https://pinger-prod-vmmessages.s3.amazonaws.com/vmmessages/123/demo.wav'};}
    return ++downloads===1?{ok:false,error:'Attachment returned HTTP 503'}:{ok:true,type:'audio/wav',size:3,base64:'AQID'};
  }});
  const a=await finished(ctx);assert.equal(links,1);assert.equal(downloads,2);
  assert.equal(a.conversations[1].captureAttempts,2);assert.equal(C.report(a).missingVoicemailAudio,0);
  assert.equal(a.conversations[1].records[0].attachments[0].error,undefined);
});

test('permanent media failures stay explicit without wasting retry passes',async()=>{
  for(const reason of ['Voicemail download permission was not granted','Unsupported voicemail host: example.test','Attachment exceeds 20 MB per-file limit']){
    let requests=0;
    const ctx=simulation('all',{media:true,sendMessage:async()=>{requests++;return {ok:false,error:reason};}});
    const a=await finished(ctx);assert.equal(requests,1);assert.equal(a.conversations[1].captureAttempts,1);
    assert.equal(C.report(a).missingVoicemailAudio,1);assert.equal(ctx.TFRunner.retry.hidden,true);
  }
});

test('Retry incomplete continues the same archive and skips previously successful conversations',async()=>{
  let ready=false,links=0;
  const ctx=simulation('all',{media:true,sendMessage:async message=>{
    if(message.type==='TF_EXPORT_VOICEMAIL'){links++;return ready?{ok:true,url:'https://pinger-prod-vmmessages.s3.amazonaws.com/vmmessages/123/demo.wav'}:{ok:false,error:'Temporary capture failure'};}
    return {ok:true,type:'audio/wav',size:3,base64:'AQID'};
  }});
  const a=await finished(ctx),startedAt=a.startedAt,first=JSON.stringify(a.conversations[0]);
  assert.equal(links,3);assert.equal(ctx.TFRunner.retry.hidden,false);
  ready=true;await ctx.TFRunner.retry.onclick();
  assert.equal(ctx.TFRunner.archive,a);assert.equal(a.startedAt,startedAt);assert.equal(a.conversations.length,2);
  assert.equal(JSON.stringify(a.conversations[0]),first);assert.equal(a.conversations[1].captureAttempts,4);
  assert.equal(links,4);assert.equal(C.report(a).missingVoicemailAudio,0);assert.equal(ctx.TFRunner.retry.hidden,true);
});

test('a shorter retry cannot discard earlier messages or saved files',async()=>{
  let links=0;
  const image='<sc-image-message><img src="https://pingerprod01usw2-pb-mmspics.s3.amazonaws.com/communications/123/demo.png"></sc-image-message>';
  const ctx=simulation('all',{media:true,bodyB:attempt=>vmRecord+(attempt===1?image:''),sendMessage:async message=>{
    if(message.type==='TF_EXPORT_VOICEMAIL')return ++links===1?{ok:false,error:'Temporary capture failure'}:{ok:true,url:'https://pinger-prod-vmmessages.s3.amazonaws.com/vmmessages/123/demo.wav'};
    return {ok:true,type:message.url.endsWith('.png')?'image/png':'audio/wav',size:3,base64:'AQID'};
  }});
  const a=await finished(ctx),c=a.conversations[1];
  assert.equal(c.captureAttempts,3);assert.equal(c.records.length,2);assert.match(c.error,/earlier capture was retained/);
  assert.equal(C.report(a).savedVoicemailAudio,1);assert.equal(C.report(a).downloadedAttachments,2);
  assert.equal(ctx.TFRunner.files.length,2);assert.equal(links,2);
});

test('Stop during retry backoff preserves captured records and prevents further attempts',async()=>{
  let links=0;
  const ctx=simulation('all',{media:true,onTick:({ctx})=>{if(ctx.TFRunner?.status.textContent.startsWith('Retry 1 of'))ctx.TFRunner.stop=true;},sendMessage:async()=>{links++;return {ok:false,error:'Temporary capture failure'};}});
  const a=await finished(ctx);assert.equal(links,1);assert.equal(a.conversations[1].captureAttempts,1);
  assert.equal(a.conversations[1].records[0].transcript,'Please call back.');assert.match(a.errors[0],/Stopped/);
});

test('framework attribute churn does not prevent otherwise stable history from settling',async()=>{
  let tick=0;
  const a=await finished(simulation('current',{onTick:({document})=>document.querySelector('.messages-container')?.setAttribute('data-render-tick',String(++tick))}));
  assert.equal(a.conversations[0].captureAttempts,1);assert.equal(a.conversations[0].history.status,'exhausted');assert.equal(a.conversations[0].records.length,2);
});
