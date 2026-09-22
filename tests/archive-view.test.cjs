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

test('activity counts exclude missed calls without losing history or counting transcripts separately',()=>{
  const a=archive([
    item('call',1,{errorType:'missedCallExtendedMessage',text:'Call notification'}),
    item('call',2,{displayText:'Missed Call 9:01 AM'}),
    item('voicemail',3,{transcript:'Sorry I missed your call.'}),
    item('message',4,{text:'Missed Call'}),
    item('call',5,{text:'Incoming Call · 2:13'})
  ]);
  const {document}=parseHTML(C.render(a)),report=C.report(a);
  assert.equal(report.recordCount,5);assert.equal(report.activityCount,3);
  assert.equal(document.querySelectorAll('.record').length,5);
  assert.equal(document.querySelectorAll('.call-event').length,3);
  assert.equal(document.querySelector('.activity-count').textContent,'3');
  assert.match(document.querySelector('.thread-meta').textContent,/1 message · 1 call · 1 voicemail/);
  const missedOnly=archive(a.conversations[0].records.slice(0,2));
  const missedDocument=parseHTML(C.render(missedOnly)).document;
  assert.equal(missedDocument.querySelector('.activity-count').textContent,'0');
  assert.match(missedDocument.querySelector('.thread-meta').textContent,/Missed calls only/);
  assert.equal(missedDocument.querySelectorAll('.call-event').length,2);
});

test('captured web links preserve labels, exact destinations, and message text',()=>{
  const url='https://shop.example.test/printers/model_3?color=black&bundle=1#details';
  const text='See this printer & its specs.\n'+url;
  const a=archive([item('message',1,{text,links:[{text:'this printer',url},{text:url,url}]})]);
  const {document}=parseHTML(C.render(a)),body=document.querySelector('.message-text');
  assert.equal(body.textContent,text);
  const anchors=[...body.querySelectorAll('a')];assert.equal(anchors.length,2);
  assert.deepEqual(anchors.map(a=>a.textContent),['this printer',url]);
  for(const a of anchors){assert.equal(a.getAttribute('href'),url);assert.equal(a.getAttribute('target'),'_blank');assert.equal(a.getAttribute('rel'),'noopener noreferrer');}
  assert.equal(document.querySelector('.message-links'),null);
});

test('plain URLs become links without swallowing punctuation or changing multiline text',()=>{
  const text='Try (https://example.test/wiki/Printer_(laser)).\nAlso https://example.test/?a=1&b=2, or www.example.test/help!';
  const {document}=parseHTML(C.render(archive([item('message',1,{text}),item('voicemail',2,{transcript:'Visit https://example.test/support.'})])));
  const body=document.querySelector('.message-text');assert.equal(body.textContent,text);
  assert.deepEqual([...body.querySelectorAll('a')].map(a=>a.getAttribute('href')),['https://example.test/wiki/Printer_(laser)','https://example.test/?a=1&b=2','https://www.example.test/help']);
  assert.equal(document.querySelector('.transcript a').getAttribute('href'),'https://example.test/support');
});

test('ambiguous labels retain every captured destination and repeated shortened URLs use the original href',()=>{
  const label='https://example.test/short',target='https://example.test/full/path?all=1&sort=2';
  const text=`Manual, Manual. ${label} then ${label}`;
  const links=[{text:'Manual',url:'https://example.test/one'},{text:'Manual',url:'https://example.test/two'},{text:label,url:target},{text:label,url:target}];
  const {document}=parseHTML(C.render(archive([item('message',1,{text,links})])));
  assert.equal(document.querySelector('.message-text').textContent,text);
  assert.deepEqual([...document.querySelectorAll('.message-text a')].map(a=>a.getAttribute('href')),[target,target]);
  assert.deepEqual([...document.querySelectorAll('.message-links a')].map(a=>a.getAttribute('href')),['https://example.test/one','https://example.test/two']);
});

test('message link rendering escapes HTML and leaves unsupported destinations inert',()=>{
  const text='<img src=x onerror=alert(1)> script data file control https://example.test/masked';
  const links=[{text:'script',url:'javascript:alert(1)'},{text:'data',url:'data:text/html,<script>alert(1)</script>'},{text:'file',url:'file:///private/test'},{text:'control',url:'https://example.test/\npath'},{text:'https://example.test/masked',url:'javascript:alert(2)'},{text:'<img src=x onerror=alert(1)>',url:'https://example.test/?q=%22&mode=1'}];
  const {document}=parseHTML(C.render(archive([item('message',1,{text,links})])));
  const body=document.querySelector('.message-text');assert.equal(body.textContent,text);
  assert.equal(body.querySelectorAll('a').length,1);assert.equal(body.querySelector('img,script'),null);
  assert.equal(body.querySelector('a').getAttribute('href'),'https://example.test/?q=%22&mode=1');
  assert.equal(document.querySelector('.message-links'),null);
});

test('captured email links preserve labels, recipients, and encoded subject and body',()=>{
  const url='mailto:help@example.test,team@example.test?subject=Printer%20help&body=First%20line%0ASecond%20line';
  const text='Please email our support team.';
  const {document}=parseHTML(C.render(archive([item('message',1,{text,links:[{text:'our support team',url}]})])));
  const body=document.querySelector('.message-text'),link=body.querySelector('a');
  assert.equal(body.textContent,text);assert.equal(link.getAttribute('href'),url);
  assert.equal(link.textContent,'our support team');assert.equal(link.getAttribute('target'),null);
  assert.equal(document.querySelector('.message-links'),null);
});

test('plain emails become mail links in messages and transcripts without changing text or splitting web URLs',()=>{
  const text="Email <info@example.test>, Alex.Smith+notes@sub.example.test.\nAlso o'connor@example.test or www.contact@example.test; visit https://example.test/?email=info@example.test and www.example.test/help.";
  const {document}=parseHTML(C.render(archive([item('message',1,{text}),item('voicemail',2,{transcript:'Reply to info@example.test!'})])));
  const body=document.querySelector('.message-text');assert.equal(body.textContent,text);
  assert.deepEqual([...body.querySelectorAll('a')].map(a=>a.getAttribute('href')),[
    'mailto:info@example.test','mailto:Alex.Smith%2Bnotes@sub.example.test',"mailto:o'connor@example.test",'mailto:www.contact@example.test',
    'https://example.test/?email=info@example.test','https://www.example.test/help'
  ]);
  assert.equal(document.querySelector('.transcript a').getAttribute('href'),'mailto:info@example.test');
  assert.equal(body.querySelector('info'),null);
});

test('repeated email addresses keep captured mail destinations and do not override unsafe captured links',()=>{
  const text='info@example.test, info@example.test; blocked@example.test.';
  const url='mailto:info@example.test?subject=Question';
  const links=[{text:'info@example.test',url},{text:'blocked@example.test',url:'javascript:alert(1)'}];
  const {document}=parseHTML(C.render(archive([item('message',1,{text,links})])));
  const body=document.querySelector('.message-text');assert.equal(body.textContent,text);
  assert.deepEqual([...body.querySelectorAll('a')].map(a=>a.getAttribute('href')),[url,url]);
  assert.equal(document.querySelector('.message-links'),null);
});

test('malformed email addresses and mail links with invalid recipients remain plain text',()=>{
  const text='bad..name@example.test bad@-example.test bad@example..test bad@example.test_ empty authority control encoded';
  const links=[{text:'empty',url:'mailto:'},{text:'authority',url:'mailto://info@example.test'},
    {text:'control',url:'mailto:info@example.test\n'},{text:'encoded',url:'mailto:info%0A@example.test'}];
  const {document}=parseHTML(C.render(archive([item('message',1,{text,links})])));
  assert.equal(document.querySelector('.message-text').textContent,text);
  assert.equal(document.querySelectorAll('.message-link').length,0);
});
