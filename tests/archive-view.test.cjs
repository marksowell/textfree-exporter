const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseHTML}=require('linkedom');
const C=require('../core.js');
const base={date:'September 21, 2026',time:'9:00 AM',direction:'incoming',text:'',transcript:'',duration:'',displayText:'',attachments:[],warnings:[]};
const item=(kind,sequence,props={})=>({...base,kind,sequence,...props});
const archive=records=>({scope:'current',startedAt:'2026-09-22T00:56:18Z',finishedAt:'2026-09-22T01:00:00Z',inbox:{status:'not-requested'},errors:[],conversations:[{id:'15550100000',contact:'Synthetic contact',history:{status:'exhausted'},records}]});
test('archive reader groups dates and keeps messages, call events, transcripts, and local recordings',()=>{
  const a=archive([item('call',1,{text:'Missed Call'}),item('voicemail',2,{duration:'0:35',transcript:'First line.\nSecond line.',attachments:[{kind:'audio',status:'saved',path:'attachments/000001.wav',mime:'audio/wav'}]}),item('message',3,{date:'September 22, 2026',direction:'outgoing',text:'Thanks for calling.'})]);
  const {document}=parseHTML(C.render(a));
  assert.equal(document.querySelectorAll('.record').length,3);assert.equal(document.querySelectorAll('.day-divider').length,2);
  assert.equal(document.querySelector('.transcript p').textContent,'First line.\nSecond line.');assert.equal(document.querySelector('.duration').textContent,'0:35');
  assert.equal(document.querySelector('audio').getAttribute('src'),'attachments/000001.wav');assert.equal(document.querySelector('.download').getAttribute('href'),'attachments/000001.wav');
  assert.equal(document.querySelector('.outgoing .message-text').textContent,'Thanks for calling.');assert.equal(document.querySelectorAll('.notice,.review-count,.thread-notes').length,0);
  assert.equal(document.querySelector('nav a').getAttribute('href'),'#c0');assert.ok(document.querySelector('#c0'));
});
test('missing files and incomplete history remain visible as specific export notes',()=>{
  const a=archive([item('voicemail',1,{transcript:'A retained transcript.',attachments:[{kind:'audio',status:'failed',error:'Recording returned HTTP 404',url:'https://example.test/private.wav'}]})]);
  a.conversations[0].history={status:'incomplete',reason:'Older pages stopped loading.'};
  const {document}=parseHTML(C.render(a));
  assert.match(document.querySelector('.notice').textContent,/HTTP 404/);assert.match(document.querySelector('.thread-notes').textContent,/Older pages stopped loading/);assert.match(document.querySelector('.review-count').textContent,/1 conversation with notes/);assert.equal(document.querySelector('audio'),null);assert.equal(document.querySelector('.transcript p').textContent,'A retained transcript.');
});
test('renderer loads in the extension isolated world and handles an empty archive',()=>{
  const vm=require('node:vm'),fs=require('node:fs');
  const context=vm.createContext({TextEncoder,Blob,URL});
  for(const file of ['archive-view.js','core.js'])vm.runInContext(fs.readFileSync(require.resolve('../'+file),'utf8'),context);
  const a=archive([]);a.conversations=[];
  const {document}=parseHTML(context.TFCore.render(a));
  assert.match(document.querySelector('main .empty').textContent,/No conversations/);assert.equal(document.querySelector('script'),null);assert.match(document.querySelector('[http-equiv="Content-Security-Policy"]').getAttribute('content'),/script-src 'none'/);
});
