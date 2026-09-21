const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function downloader(options={}){
  let listener,requests=[];
  const ctx={URL,AbortController,Uint8Array,btoa,setTimeout,clearTimeout,chrome:{permissions:{contains:async()=>options.allowed!==false},runtime:{onMessage:{addListener(f){listener=f;}}}},fetch:async(url,config)=>{requests.push({url,config});return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':options.type||'image/jpeg'}});}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../background.js'),'utf8'),ctx);
  return {requests,run:(url,sender={tab:{id:1},url:'https://messages.textfree.us/conversation/1'})=>new Promise(resolve=>listener({type:'TF_EXPORT_MEDIA',url},sender,resolve))};
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
