const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {parseHTML}=require('linkedom');
const recording='https://pinger-prod-vmmessages.s3.amazonaws.com/vmmessages/123/2026/synthetic.wav';
const pageUrl='https://messages.textfree.us/conversation/15550100000';
const expected={duration:'0:12',time:'9:00 AM',transcript:'Synthetic test voicemail.'};
function fixture(options={}) {
  const record='<sc-voice-mail-message><button data-testid="voicemail-msg-bubble"><span class="voicemail-time">0:12</span></button><span class="message-time">9:00 AM</span><div class="voicemail-transcription-text">Synthetic test voicemail.</div></sc-voice-mail-message>';
  const {document}=parseHTML(`<html><body><communications-detail-page class="ion-page-hidden"><div class="messages-container">${record}</div></communications-detail-page><communications-detail-page><div class="messages-container">${record}${record}</div></communications-detail-page></body></html>`);
  let popups=0,clicks=[];
  const originalOpen=()=>{popups++;};
  const window={open:originalOpen};
  const ctx={window,document,location:{href:pageUrl,origin:'https://messages.textfree.us'}};
  const buttons=[...document.querySelectorAll('button')];
  buttons.forEach((button,index)=>button.addEventListener('click',()=>{clicks.push(index);if(!options.noLink)window.open(recording,'_blank','noopener,noreferrer');if(options.extraLink)window.open('https://example.org/');}));
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../voicemail.js'),'utf8'),ctx);
  return {ctx,clicks,originalOpen,get popups(){return popups;},run:(changes={})=>ctx.captureVoicemailLink({pageUrl,ordinal:1,expected,...changes})};
}
test('captures the requested visible voicemail link without opening a popup and restores window.open',()=>{
  const f=fixture();assert.equal(f.run(),recording);assert.deepEqual(f.clicks,[2]);assert.equal(f.popups,0);assert.equal(f.ctx.window.open,f.originalOpen);
  f.ctx.window.open('https://example.org/');assert.equal(f.popups,1);
});
test('conversation, ordinal, and record mismatch guards prevent any voicemail click',()=>{
  for(const change of [{pageUrl:pageUrl+'2'},{ordinal:10},{expected:{...expected,duration:'0:13'}},{expected:{...expected,time:'10:00 AM'}},{expected:{...expected,transcript:'Changed'}}]){
    const f=fixture();assert.throws(()=>f.run(change),/changed|Changed|capture/);assert.deepEqual(f.clicks,[]);assert.equal(f.ctx.window.open,f.originalOpen);
  }
});
test('no-link and ambiguous-link failures restore normal popup behavior',()=>{
  for(const options of [{noLink:true},{extraLink:true}]){const f=fixture(options);assert.throws(()=>f.run(),/one recording link/);assert.equal(f.ctx.window.open,f.originalOpen);assert.equal(f.popups,0);}
});
test('a click failure restores window.open',()=>{
  const f=fixture();f.ctx.document.querySelectorAll('button')[2].click=()=>{throw new Error('Synthetic click failure');};
  assert.throws(()=>f.run(),/Synthetic click failure/);assert.equal(f.ctx.window.open,f.originalOpen);
});
test('ambiguous visible conversation pages cannot be used to capture audio',()=>{
  const f=fixture();f.ctx.document.querySelector('.ion-page-hidden').classList.remove('ion-page-hidden');assert.throws(()=>f.run(),/active voicemail conversation/);assert.deepEqual(f.clicks,[]);
});
