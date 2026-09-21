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
function simulation(mode='all'){
  const {document,window}=parseHTML('<html><body><ion-content class="conversation-list-content"><ion-list class="conversation-list"><ion-item class="conversation conversation-selected"><p class="contact">A</p></ion-item></ion-list><ion-infinite-scroll class="hydrated infinite-scroll-enabled"></ion-infinite-scroll></ion-content><communications-detail-page><ion-content class="conversation-container"><ion-infinite-scroll class="hydrated infinite-scroll-enabled"></ion-infinite-scroll><div class="messages-container"><span class="communication-date">September 21, 2026</span>'+message+'</div></ion-content></communications-detail-page></body></html>');
  let clock=0,listener;const location={origin:'https://messages.textfree.us',pathname:'/conversation/1',get href(){return this.origin+this.pathname;}};
  const ctx={TFCore:C,document,location,console,URL,Blob,TextEncoder,Uint8Array,Event:window.Event,atob,btoa,Date:class extends Date{static now(){return clock;}},setTimeout:(f,ms)=>{clock+=ms;setImmediate(f);return 1;},chrome:{runtime:{onMessage:{addListener(f){listener=f;}},sendMessage:async()=>({ok:false,error:'simulated inaccessible attachment'})}}};
  for(const el of document.querySelectorAll('ion-content')){const s=el.attachShadow({mode:'open'});s.innerHTML='<div class="inner-scroll"></div>';}
  const list=document.querySelector('.conversation-list-content'),history=document.querySelector('.conversation-container');let events=0;
  list.shadowRoot.querySelector('.inner-scroll').addEventListener('scroll',()=>{
    if(events++)return;list.querySelector('ion-list').insertAdjacentHTML('beforeend','<ion-item class="conversation"><p class="contact">B</p></ion-item>');list.querySelector('ion-infinite-scroll').classList.remove('infinite-scroll-enabled');
    document.querySelectorAll('.contact')[1].addEventListener('click',()=>{
      if(mode==='navigation-fails')return;
      document.querySelector('.conversation-selected').classList.remove('conversation-selected');document.querySelectorAll('.conversation')[1].classList.add('conversation-selected');location.pathname='/conversation/2';history.querySelector('.messages-container').innerHTML='<span class="communication-date">September 20, 2026</span>'+vmRecord;history.querySelector('ion-infinite-scroll').classList.remove('infinite-scroll-enabled');
    });
  });
  history.shadowRoot.querySelector('.inner-scroll').addEventListener('scroll',()=>{
    if(mode==='stall')return;
    const infinite=history.querySelector('ion-infinite-scroll');
    if(infinite.classList.contains('infinite-scroll-enabled')){history.querySelector('.messages-container').insertAdjacentHTML('beforeend',message);infinite.classList.remove('infinite-scroll-enabled');}
    if(mode==='stop')ctx.TFRunner.stop=true;
  });
  vm.runInNewContext(fs.readFileSync(require.resolve('../collector.js'),'utf8'),ctx);
  listener({type:'TF_EXPORT_START',scope:mode==='all'||mode==='navigation-fails'?'all':'current',media:false},{},()=>{});
  return ctx;
}
async function finished(ctx){for(let i=0;i<1000&&ctx.TFRunner.running;i++)await new Promise(setImmediate);assert.equal(ctx.TFRunner.running,false);return ctx.TFRunner.archive;}
test('collector paginates inbox and history and retains repeated messages',async()=>{const a=await finished(simulation());assert.equal(a.inbox.status,'exhausted');assert.equal(a.inbox.discoveredConversations,2);assert.equal(a.conversations.length,2);assert.equal(a.conversations[0].records.length,2);assert.equal(a.conversations[0].history.status,'exhausted');assert.equal(a.conversations[1].id,'2');assert.equal(a.conversations[1].records[0].kind,'voicemail');});
test('pagination stalls are explicitly incomplete',async()=>{const a=await finished(simulation('stall'));assert.equal(a.conversations[0].history.status,'incomplete');assert.match(a.conversations[0].history.reason,/three attempts/);});
test('stop preserves the current capture and marks it incomplete',async()=>{const a=await finished(simulation('stop'));assert.equal(a.conversations[0].records.length,2);assert.equal(a.conversations[0].history.status,'incomplete');assert.match(a.errors[0],/Stopped/);});
test('navigation failure cannot archive the previous chat under a new label',async()=>{const a=await finished(simulation('navigation-fails'));assert.equal(a.conversations.length,2);assert.equal(a.conversations[1].records.length,0);assert.ok(a.conversations[1].error);assert.match(a.conversations[1].id,/unopened/);});
