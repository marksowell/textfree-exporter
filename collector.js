(function(){
  'use strict';
  if(globalThis.TFRunner)return;
  const C=globalThis.TFCore;
  const RETRY_PASSES=2;
  const state=globalThis.TFRunner={running:false,stop:false,archive:null,files:[],bytes:0,mediaCache:new Map(),targets:[]};
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const active=()=>{const pages=[...document.querySelectorAll('communications-detail-page')].filter(e=>!e.closest('.ion-page-hidden,.ion-page-invisible,[aria-hidden="true"]'));return pages.length===1?pages[0]:null;};
  const list=()=>document.querySelector('ion-content.conversation-list-content');
  const rows=()=>[...document.querySelectorAll('ion-list.conversation-list ion-item.conversation')];
  const text=e=>(e?.textContent||'').trim();
  const check=()=>{if(state.stop)throw new Error('Stopped by user; archive contains only work collected so far.');if(location.origin!=='https://messages.textfree.us')throw new Error('TextFree page is no longer available.');};
  function status(s){state.status.textContent=s;}
  const permanentMediaError=reason=>/permission|download was disabled|unsupported (?:attachment|voicemail|media)|(?:20 MB|200 MB|archive limit)|not a WAV recording/i.test(reason||'');
  function needsRetry(conversation){
    if(!conversation)return false;
    if(conversation.error||conversation.history?.status!=='exhausted')return true;
    if(!state.archive.mediaRequested)return false;
    return conversation.records.some(r=>r.attachments.some(a=>a.status!=='saved'&&a.status!=='not-requested'&&!permanentMediaError(a.error))||
      (r.kind==='voicemail'&&!r.attachments.some(a=>a.kind==='audio')&&!r.warnings.some(permanentMediaError)));
  }
  async function retryPause(milliseconds){for(let elapsed=0;elapsed<milliseconds;elapsed+=200){check();await pause(Math.min(200,milliseconds-elapsed));}check();}
  // Ignore changing framework attributes; wait for actual text/media and loaders.
  function contentKey(content){return content?JSON.stringify([content.textContent,content.children.length,[...content.querySelectorAll('img[src],video[src],audio[src],source[src],a[href]')].map(el=>[el.tagName,el.getAttribute('src')||el.getAttribute('href')])]):'';}
  function panel(){
    state.host?.remove();
    const host=document.createElement('div');state.host=host;
    host.style.cssText='position:fixed;right:18px;bottom:18px;z-index:2147483647;max-width:360px;width:calc(100vw - 36px)';
    const shadow=host.attachShadow({mode:'closed'});
    shadow.innerHTML='<style>:host{all:initial}section{font:14px/1.45 system-ui;color:#173b2f;background:#f8faf6;border:1px solid #c5d2c6;max-height:calc(100vh - 36px);overflow:auto;border-radius:10px;padding:18px;box-shadow:0 8px 32px #0003}h2{font-size:17px;margin:0 0 10px}p{white-space:pre-wrap;overflow-wrap:anywhere}button{font:600 12px system-ui;border-radius:5px;border:1px solid #41755c;padding:9px;margin:4px 5px 0 0;background:white;color:#174a32;cursor:pointer}button:disabled{opacity:.5}button[hidden]{display:none}small{display:block;margin-top:10px;color:#5c685f}</style><section><h2>TextFree local export</h2><p role="status"></p><button id="stop">Stop and keep progress</button><button id="save">Download ZIP</button><button id="close">Close</button><small>Keep this tab open until capture finishes. Download the ZIP to save your archive.</small></section>';
    document.documentElement.append(host);
    state.status=shadow.querySelector('p');state.save=shadow.querySelector('#save');state.save.disabled=true;
    state.retry=document.createElement('button');state.retry.textContent='Retry incomplete';state.retry.hidden=true;
    shadow.querySelector('#close').before(state.retry);
    state.retry.onclick=retryIncomplete;
    shadow.querySelector('#stop').onclick=()=>{state.stop=true;status('Stopping… the current capture will be retained.');};
    state.save.onclick=()=>download();
    shadow.querySelector('#close').onclick=()=>{if(state.running){state.stop=true;status('Stopping… download your progress before closing.');}else host.remove();};
  }
  async function waitFor(fn,timeout=20000){
    const until=Date.now()+timeout;
    while(Date.now()<until){check();if(fn())return;await pause(200);}
    throw new Error(`TextFree did not finish loading within ${timeout/1000} seconds.`);
  }
  async function settle(scope,timeout=20000){
    let last=null,stable=0;
    const until=Date.now()+timeout;
    while(Date.now()<until){
      check();const el=scope(),content=el?.querySelector('.messages-container,ion-list')||el;
      const next=contentKey(content);
      const busy=!!el?.querySelector('.infinite-scroll-loading,ion-loading:not(.overlay-hidden)');
      if(next&&next===last&&!busy){stable+=200;if(stable>=1000)return;}else stable=0;
      last=next;await pause(200);
    }
    throw new Error('Content never settled; history may be incomplete.');
  }
  async function exhaust(content,direction,description,timeout=20000){
    let stagnant=0;
    for(let attempt=0;attempt<2000;attempt++){
      check();const host=content();if(!host)throw new Error('History container disappeared.');
      const infinite=host.querySelector('ion-infinite-scroll');
      if(!infinite)return {status:'unknown',reason:'No pagination indicator exists',attempts:attempt};
      if(!infinite.classList.contains('infinite-scroll-enabled')&&!infinite.classList.contains('infinite-scroll-loading'))return {status:'exhausted',attempts:attempt};
      const scroll=host.shadowRoot?.querySelector('.inner-scroll');
      if(!scroll)return {status:'unknown',reason:'Cannot access the history scroll area',attempts:attempt};
      const before=contentKey(host.querySelector('.messages-container,ion-list'));
      status(`${description}\nLoading ${direction==='top'?'older messages':'more conversations'}…`);
      // Scroll the Ionic container itself. Do not call private application APIs.
      scroll.scrollTop=direction==='top'?Math.min(180,scroll.scrollHeight):Math.max(0,scroll.scrollHeight-scroll.clientHeight-180);
      scroll.dispatchEvent(new Event('scroll'));
      await pause(180);check();
      scroll.scrollTop=direction==='top'?0:scroll.scrollHeight;
      scroll.dispatchEvent(new Event('scroll'));
      await pause(1000);
      await settle(content,timeout);
      const after=contentKey(host.querySelector('.messages-container,ion-list'));
      if(after===before)stagnant++;else stagnant=0;
      if(stagnant>=3){
        if(!infinite.classList.contains('infinite-scroll-enabled')&&!infinite.classList.contains('infinite-scroll-loading'))return {status:'exhausted',attempts:attempt+1};
        return {status:'incomplete',reason:'Pagination stayed enabled but stopped making progress after three attempts',attempts:attempt+1};
      }
    }
    return {status:'incomplete',reason:'Reached the 2,000-page safety limit'};
  }
  async function openRow(row,timeout=20000,retry=false){
    check();
    if(!row.isConnected)throw new Error('Inbox changed while exporting; this conversation was not opened.');
    const previous=location.pathname,already=row.classList.contains('conversation-selected');
    const target=row.querySelector('.contact');if(!target)throw new Error('Conversation label is missing.');
    if(!already||retry){target.click();await waitFor(()=>(already?location.pathname===previous:location.pathname!==previous)&&location.pathname.startsWith('/conversation/')&&row.classList.contains('conversation-selected')&&!!active()?.querySelector('.messages-container'),timeout);}
    await settle(active,timeout);
    if(!row.classList.contains('conversation-selected'))throw new Error('Selected conversation changed unexpectedly.');
  }
  async function media(conversation){
    for(const record of conversation.records){
      for(const item of record.attachments){
        check();
        if(item.status==='saved'||permanentMediaError(item.error))continue;
        if(state.mediaCache.has(item.url)){Object.assign(item,state.mediaCache.get(item.url));delete item.error;continue;}
        if(!state.archive.mediaRequested){item.status='not-requested';item.error='Attachment download was disabled or permission was declined';continue;}
        if(state.bytes>=200*1024*1024){item.status='failed';item.error='Archive reached the 200 MB attachment limit';continue;}
        status(`Saving attachment for ${conversation.contact||conversation.id}…`);
        let result;try{result=await chrome.runtime.sendMessage({type:'TF_EXPORT_MEDIA',url:item.url});}catch(e){result={ok:false,error:e.message};}
        if(!result?.ok){Object.assign(item,{status:'failed',error:result?.error||'No response from attachment downloader'});continue;}
        if(state.bytes+result.size>200*1024*1024){Object.assign(item,{status:'failed',error:'Attachment would exceed the 200 MB archive limit'});continue;}
        const suffix={'image/jpeg':'jpg','image/png':'png','image/gif':'gif','image/webp':'webp','image/avif':'avif','image/bmp':'bmp','video/mp4':'mp4','audio/mpeg':'mp3','audio/mp4':'m4a','audio/wav':'wav','audio/x-wav':'wav','audio/wave':'wav','application/pdf':'pdf'}[result.type]||'bin';
        const path=`attachments/${String(state.files.length+1).padStart(6,'0')}.${suffix}`;
        const bytes=Uint8Array.from(atob(result.base64),c=>c.charCodeAt(0));
        state.files.push({name:path,data:bytes});state.bytes+=bytes.length;
        const saved={status:'saved',path,mime:result.type,size:bytes.length};Object.assign(item,saved);delete item.error;state.mediaCache.set(item.url,saved);
      }
    }
  }
  async function voicemails(conversation){
    const records=conversation.records.filter(r=>r.kind==='voicemail');
    for(let ordinal=0;ordinal<records.length;ordinal++){
      check();
      const record=records[ordinal];
      if(record.warnings.some(permanentMediaError))continue;
      record.warnings=record.warnings.filter(w=>w!==C.VOICEMAIL_WARNING&&!w.startsWith('Voicemail audio not saved:'));
      if(record.attachments.some(a=>a.kind==='audio'))continue;
      if(!state.archive.mediaRequested){record.warnings.push('Voicemail audio not saved: media download was disabled or permission was declined.');continue;}
      if(location.href!==conversation.url)throw new Error('Conversation changed before voicemail capture');
      status(`Finding voicemail ${ordinal+1} of ${records.length} for ${conversation.contact||conversation.id}…`);
      let result;
      try{
        result=await chrome.runtime.sendMessage({type:'TF_EXPORT_VOICEMAIL',pageUrl:conversation.url,ordinal,expected:{duration:record.duration,time:record.time,transcript:record.transcript}});
      }catch(e){result={ok:false,error:e.message};}
      if(!result?.ok){record.warnings.push(`Voicemail audio not saved: ${result?.error||'No recording link returned'}`);continue;}
      record.attachments.push({url:result.url,kind:'audio',alt:'Voicemail recording',status:'pending'});
    }
  }
  function capture(){return C.extract(document,location.href);}
  const recordKey=r=>JSON.stringify([r.kind,r.date,r.time,r.direction,r.text,r.transcript,r.duration,r.errorType]);
  function inheritMedia(destination,source){
    if(!source||destination.id!==source.id)return;
    const byRecord=new Map();
    for(const record of source.records){const key=recordKey(record);if(!byRecord.has(key))byRecord.set(key,[]);byRecord.get(key).push(record);}
    // Match duplicate records from the newest end; loading older history prepends records.
    for(const record of [...destination.records].reverse()){
      const old=byRecord.get(recordKey(record))?.pop();if(!old)continue;
      for(const attachment of old.attachments){
        const current=record.attachments.find(a=>a.url===attachment.url&&a.kind===attachment.kind);
        if(current&&(attachment.status==='saved'||permanentMediaError(attachment.error))){Object.assign(current,attachment);if(attachment.status==='saved')delete current.error;}
        else if(!current&&(attachment.status==='saved'||record.kind==='voicemail'))record.attachments.push({...attachment});
      }
      for(const warning of old.warnings.filter(permanentMediaError))if(!record.warnings.includes(warning))record.warnings.push(warning);
      if(record.attachments.some(a=>a.kind==='audio'&&a.status==='saved'))record.warnings=record.warnings.filter(w=>w!==C.VOICEMAIL_WARNING&&!w.startsWith('Voicemail audio not saved:'));
    }
  }
  function retainAttempt(target,candidate,previous,attempts){
    let result=candidate||{...previous};
    if(candidate&&previous&&previous.records.length>candidate.records.length){
      inheritMedia(previous,candidate);
      result={...previous,error:candidate.error||'Retry returned fewer records; the earlier capture was retained.'};
    }
    result.captureAttempts=attempts;
    target.conversation=result;state.archive.conversations[target.index]=result;
    return result;
  }
  function resolveRow(target){
    if(target.element?.isConnected)return target.element;
    if(!target.element)return null;
    const matches=rows().filter(row=>text(row.querySelector('.contact'))===target.label);
    if(matches.length!==1)throw new Error('Could not uniquely find this conversation in the inbox for retry.');
    target.element=matches[0];return target.element;
  }
  async function collect(target,description=target.label){
    if(target.index===undefined){target.index=state.archive.conversations.length;target.conversation={id:`unopened-${target.index+1}`,contact:target.label,records:[]};state.archive.conversations.push(target.conversation);}
    const previous=target.conversation,attempts=(previous.captureAttempts||0)+1,timeout=attempts>1?40000:20000;
    let conversation;
    try{
      const row=resolveRow(target);
      if(row)await openRow(row,timeout,attempts>1);
      else {if(target.url&&location.href!==target.url)throw new Error('Conversation changed before retry.');await settle(active,timeout);}
      const first=capture();
      if(target.expectedId&&first.id!==target.expectedId)throw new Error('Opened conversation did not match the retry target.');
      conversation=first;target.expectedId=first.id;target.url=first.url;
      inheritMedia(conversation,previous);retainAttempt(target,conversation,previous,attempts);
      const route=location.pathname;
      const content=()=>{if(location.pathname!==route)throw new Error('Conversation changed while loading history');return active()?.querySelector('ion-content.conversation-container');};
      try{conversation.history=await exhaust(content,'top',description,timeout);}
      catch(e){conversation.history={status:'incomplete',reason:e.message};conversation.error=e.message;if(state.stop)throw e;}
      finally{
        if(location.pathname===route){
          const newer=capture();
          if(newer.id!==target.expectedId)throw new Error('Conversation changed while capturing history.');
          inheritMedia(newer,conversation);inheritMedia(newer,previous);
          Object.assign(conversation,{records:newer.records,contact:newer.contact,preview:newer.preview});
        }
      }
      // Even if older history stalled, save the safely identified visible media.
      check();
      await voicemails(conversation);
      await media(conversation);
    }catch(e){
      if(!conversation)conversation={...previous};
      conversation.error=e.message;conversation.history=conversation.history||{status:'incomplete',reason:e.message};
      if(state.stop)throw e;
    }finally{retainAttempt(target,conversation,previous,attempts);}
  }
  async function retryPasses(){
    for(let pass=1;pass<=RETRY_PASSES;pass++){
      const pending=state.targets.filter(target=>needsRetry(target.conversation));
      if(!pending.length)return;
      for(let i=0;i<pending.length;i++){
        const target=pending[i],description=`Retry ${pass} of ${RETRY_PASSES}, conversation ${i+1} of ${pending.length}: ${target.label}`;
        status(description);await retryPause(pass*1500);
        await collect(target,description);
      }
    }
  }
  async function scanInbox(){
    for(let attempt=1;attempt<=RETRY_PASSES+1;attempt++){
      const description=attempt===1?'Scanning the inbox':`Retrying inbox loading (${attempt-1} of ${RETRY_PASSES})`;
      status(description);
      if(attempt>1)await retryPause((attempt-1)*1500);
      try{
        await settle(list,attempt===1?20000:40000);
        state.archive.inbox=await exhaust(list,'bottom',description,attempt===1?20000:40000);
      }catch(e){state.archive.inbox={status:'incomplete',reason:e.message};if(state.stop)throw e;}
      state.archive.inbox.captureAttempts=attempt;
      if(state.archive.inbox.status==='exhausted')return;
    }
    state.archive.errors.push(`Inbox may be incomplete after three attempts: ${state.archive.inbox.reason}`);
  }
  function download(){
    if(!state.archive)return;
    const archive=state.archive;archive.finishedAt=archive.finishedAt||new Date().toISOString();
    const entries=[{name:'index.html',data:C.render(archive)},{name:'archive.json',data:JSON.stringify(archive,null,2)},{name:'report.json',data:JSON.stringify(C.report(archive),null,2)},...state.files];
    const blob=C.zip(entries),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=`textfree-${archive.startedAt.replace(/[:.]/g,'-')}.zip`;document.documentElement.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    state.save.textContent='Download ZIP again';
  }
  function finish(original){
    state.archive.finishedAt=new Date().toISOString();state.running=false;state.save.disabled=false;
    const pending=state.targets.filter(target=>needsRetry(target.conversation));
    state.retry.hidden=!pending.length;state.retry.disabled=false;state.retry.textContent=`Retry incomplete (${pending.length})`;
    const result=C.report(state.archive);
    const failures=result.voicemailFailureReasons.slice(0,3).map(f=>`${f.count} recording(s): ${f.reason}`).join('\n');
    const lines=[`${state.stop?'Capture stopped.':'Capture finished.'} ${result.conversationCount} ${result.conversationCount===1?'conversation':'conversations'}, ${result.activityCount} activity ${result.activityCount===1?'entry':'entries'}.`];
    if(result.voicemailCount)lines.push(`${result.savedVoicemailAudio} of ${result.voicemailCount} voicemail recordings saved; ${result.missingVoicemailAudio} missing.`);
    if(failures)lines.push(failures);
    if(result.downloadedAttachments||result.unsavedAttachments)lines.push(`${result.downloadedAttachments} media files saved${result.unsavedAttachments?`; ${result.unsavedAttachments} discovered files not saved`:''}.`);
    if(result.conversationsNeedingReview.length)lines.push(`${result.conversationsNeedingReview.length} ${result.conversationsNeedingReview.length===1?'conversation has':'conversations have'} export notes.`);
    if(pending.length&&!state.stop)lines.push('Automatic retries finished. Retry incomplete to try only the remaining conversations again.');
    lines.push('Click Download ZIP to save the archive.',...result.errors);
    status(lines.join('\n'));
    // Restore only the original selected row, never use browser history or forms.
    if(location.origin==='https://messages.textfree.us'&&original?.isConnected&&!original.classList.contains('conversation-selected'))original.querySelector('.contact')?.click();
  }
  async function retryIncomplete(){
    if(state.running||!state.archive)return;
    state.running=true;state.stop=false;state.save.disabled=true;state.retry.disabled=true;
    const original=document.querySelector('ion-item.conversation-selected');
    try{await retryPasses();}
    catch(e){state.archive.errors.push(e.message);}
    finally{finish(original);}
  }
  async function run(options){
    state.running=true;state.stop=false;state.files=[];state.bytes=0;state.mediaCache=new Map();state.targets=[];panel();
    state.archive={format:'textfree-local-export',version:1,scope:options.scope,startedAt:new Date().toISOString(),mediaRequested:!!options.media,accountDisplay:text(document.querySelector('#dropdown-menu h3')),conversations:[],errors:[],inbox:{status:options.scope==='all'?'pending':'not-requested'}};
    const original=document.querySelector('ion-item.conversation-selected');
    try{
      if(options.scope==='all'){
        await scanInbox();
        state.targets=rows().map(element=>({element,label:text(element.querySelector('.contact'))}));
        state.archive.inbox.discoveredConversations=state.targets.length;
        if(!state.targets.length)throw new Error('No conversations found. Check that TextFree is signed in.');
        for(let i=0;i<state.targets.length;i++){check();const target=state.targets[i];status(`Conversation ${i+1} of ${state.targets.length}: ${target.label}`);await collect(target);}
      }else{
        const target={element:original,label:text(original?.querySelector('.contact'))||'Current conversation',url:location.href};
        state.targets=[target];await collect(target);
      }
      await retryPasses();
    }catch(e){state.archive.errors.push(e.message);}
    finally{finish(original);}
  }
  chrome.runtime.onMessage.addListener((message,_sender,reply)=>{
    if(message?.type!=='TF_EXPORT_START')return;
    if(location.origin!=='https://messages.textfree.us'){reply({ok:false,error:'This is not TextFree Web.'});return;}
    if(state.running){reply({ok:false,error:'An export is already running. Use its on-page controls.'});return;}
    if(!['all','current'].includes(message.scope)){reply({ok:false,error:'Invalid export scope'});return;}
    run(message).catch(e=>{state.running=false;if(state.status)status(`Exporter failed: ${e.message}`);});
    reply({ok:true});
  });
})();
