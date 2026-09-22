(function(root){
  'use strict';
  const VOICEMAIL_WARNING='Voicemail audio has not been captured; transcript and duration retained.';
  function extract(doc, url) {
    const text=e=>(e?.textContent||'').replace(/[\uE000-\uF8FF]/g,'').trim();
    const pages=[...doc.querySelectorAll('communications-detail-page')].filter(e=>!e.closest('.ion-page-hidden,.ion-page-invisible,[aria-hidden="true"]'));
    if(pages.length!==1) throw new Error('Could not identify exactly one active conversation.');
    const page=pages[0],container=page.querySelector('.messages-container');
    if(!container) throw new Error('Messages have not loaded.');
    const selected=doc.querySelector('ion-item.conversation-selected');
    const route=new URL(url);
    if(!route.pathname.startsWith('/conversation/')) throw new Error('Open a conversation first.');
    const result={id:decodeURIComponent(route.pathname.slice('/conversation/'.length)),url,contact:text(selected?.querySelector('.contact')),preview:text(selected?.querySelector('[data-testid="msg-preview-element"]')),records:[],warnings:[]};
    let date='';
    for(const node of container.children){
      if(node.matches('.communication-date')){date=text(node);continue;}
      const component=node.tagName.toLowerCase();
      if(!text(node)&&!node.querySelector('img,video,audio,source'))continue;
      let kind='unknown';
      if(component==='sc-chat-bubble')kind='message';
      else if(component==='sc-chat-error-message')kind=/call/i.test(node.getAttribute('errortype')||'')?'call':'notice';
      else if(component==='sc-voice-mail-message')kind='voicemail';
      else if(/image|video|audio|file|document/.test(component))kind='attachment';
      const sent=!!node.querySelector('.user-bubble,.sent-message');
      let direction=sent?'outgoing':node.querySelector('.received-message')||kind==='voicemail'?'incoming':'unknown';
      const errorType=node.getAttribute('errortype')||'';
      if(kind==='call')direction=/outgoing|sent|placed/i.test(errorType+' '+text(node))?'outgoing':/incoming|received|missed/i.test(errorType+' '+text(node))?'incoming':'unknown';
      const record={sequence:result.records.length+1,kind,component,date,time:text(node.querySelector('.message-time')),direction,sender:text(node.querySelector('[data-testid$="contact-name-attribution"]')),text:[...node.querySelectorAll('.text-item')].map(text).join('\n'),transcript:text(node.querySelector('.voicemail-transcription-text')),duration:text(node.querySelector('.voicemail-time')),errorType,attribution:text(node.querySelector('[data-testid="chat-message-type-attribution"]')),reactions:text(node.querySelector('[data-testid="reactions-bubbles-container"]')),displayText:text(node),links:[],attachments:[],warnings:[]};
      for(const link of node.querySelectorAll('a[href]')){const href=link.getAttribute('href');if(href)record.links.push({text:text(link),url:href});}
      const candidates=[...node.querySelectorAll('img[src],video[src],audio[src],source[src]')];
      if(kind==='attachment')candidates.push(...node.querySelectorAll('a[href]'));
      const seen=new Set();
      for(const el of candidates){
        const raw=el.getAttribute(el.tagName==='A'?'href':'src');
        if(!raw)continue;
        let href;try{href=new URL(raw,url).href;}catch{continue;}
        if(seen.has(href))continue;seen.add(href);
        const type=el.tagName==='IMG'?'image':el.tagName==='A'?'file':el.tagName==='SOURCE'?el.parentElement.tagName.toLowerCase():el.tagName.toLowerCase();
        record.attachments.push({url:href,kind:type,alt:el.getAttribute('alt')||'',status:'pending'});
      }
      if(kind==='voicemail'&&!record.attachments.some(a=>a.kind==='audio'))record.warnings.push(VOICEMAIL_WARNING);
      if(kind==='attachment'&&!record.attachments.length)record.warnings.push('Attachment is present but the page exposes no downloadable URL.');
      if(kind==='unknown')record.warnings.push(`Unrecognized component ${component}; only displayed text and exposed media captured.`);
      if(!date)record.warnings.push('No date heading was available for this record.');
      result.records.push(record);
    }
    return result;
  }
  function escape(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function report(archive){
    const conversations=archive.conversations||[],records=conversations.flatMap(c=>c.records||[]),attachments=records.flatMap(r=>r.attachments||[]);
    const failureCounts=new Map();
    for(const record of records.filter(r=>r.kind==='voicemail'&&!r.attachments.some(a=>a.kind==='audio'&&a.status==='saved'))){
      const reasons=record.warnings.filter(w=>/voicemail/i.test(w));
      reasons.push(...record.attachments.filter(a=>a.kind==='audio'&&a.status!=='saved').map(a=>a.error||a.status));
      for(const reason of new Set(reasons.length?reasons:['Voicemail recording URL was not found']))failureCounts.set(reason,(failureCounts.get(reason)||0)+1);
    }
    const voicemailFailureReasons=[...failureCounts].map(([reason,count])=>({reason,count})).sort((a,b)=>b.count-a.count);
    return {scope:archive.scope,startedAt:archive.startedAt,finishedAt:archive.finishedAt||null,inbox:archive.inbox,conversationCount:conversations.length,recordCount:records.length,voicemailFailureReasons,voicemailCount:records.filter(r=>r.kind==='voicemail').length,savedVoicemailAudio:records.filter(r=>r.kind==='voicemail'&&r.attachments.some(a=>a.kind==='audio'&&a.status==='saved')).length,missingVoicemailAudio:records.filter(r=>r.kind==='voicemail'&&!r.attachments.some(a=>a.kind==='audio'&&a.status==='saved')).length,downloadedAttachments:attachments.filter(a=>a.status==='saved').length,unsavedAttachments:attachments.filter(a=>a.status!=='saved').length,conversationsNeedingReview:conversations.filter(c=>c.history?.status!=='exhausted'||c.error||c.records.some(r=>r.warnings.length||r.attachments.some(a=>a.status!=='saved')||(r.kind==='voicemail'&&!r.attachments.some(a=>a.kind==='audio'&&a.status==='saved')))).map(c=>({id:c.id,contact:c.contact,history:c.history,error:c.error||null,warnings:c.records.flatMap(r=>[...r.warnings.map(w=>`Record ${r.sequence}: ${w}`),...r.attachments.filter(a=>a.status!=='saved').map(a=>`Record ${r.sequence}: ${a.error||a.status}`)])})),errors:archive.errors||[],serverCompletenessVerified:false,limitations:['Captures only history exposed by TextFree Web. Deleted, expired, app-only, and otherwise unavailable data cannot be recovered.','Dates and times are the site’s displayed values; timezone and precise server timestamps are not inferred.','An exhausted history indicator means the site stopped offering older pages. It is not independent proof of a full account backup.','Voicemail recordings are saved when the Play button exposes a supported, accessible WAV file. Missing recordings and uncertain history are reported per conversation.']};
  }
  const view=typeof module!=='undefined'?require('./archive-view.js'):root.TFArchiveView;
  function render(archive){return view.render(archive,report(archive),escape);}
  const encoder=new TextEncoder();
  const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
  function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
  function zip(entries){
    if(entries.length>65535)throw new Error('Too many files for this ZIP format.');
    const parts=[],central=[];let offset=0,centralSize=0;
    function header(length){const a=new Uint8Array(length);return [a,new DataView(a.buffer)];}
    for(const entry of entries){
      if(!/^[a-zA-Z0-9_./-]+$/.test(entry.name)||entry.name.includes('..')||entry.name.startsWith('/'))throw new Error('Unsafe archive filename');
      const name=encoder.encode(entry.name),bytes=typeof entry.data==='string'?encoder.encode(entry.data):entry.data,crc=crc32(bytes);
      if(bytes.length+offset>0xffffffff)throw new Error('Archive exceeds ZIP32 limit');
      const [local,v]=header(30);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,33,true);v.setUint32(14,crc,true);v.setUint32(18,bytes.length,true);v.setUint32(22,bytes.length,true);v.setUint16(26,name.length,true);
      parts.push(local,name,bytes);
      const [cent,d]=header(46);d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint16(14,33,true);d.setUint32(16,crc,true);d.setUint32(20,bytes.length,true);d.setUint32(24,bytes.length,true);d.setUint16(28,name.length,true);d.setUint32(42,offset,true);central.push(cent,name);centralSize+=46+name.length;offset+=30+name.length+bytes.length;
    }
    const [end,v]=header(22);v.setUint32(0,0x06054b50,true);v.setUint16(8,entries.length,true);v.setUint16(10,entries.length,true);v.setUint32(12,centralSize,true);v.setUint32(16,offset,true);
    return new Blob([...parts,...central,end],{type:'application/zip'});
  }
  root.TFCore={extract,escape,report,render,zip,crc32,VOICEMAIL_WARNING};
  if(typeof module!=='undefined')module.exports=root.TFCore;
})(globalThis);
