const mediaOrigins = [
  'https://pingerprod01usw2-pb-mmspics.s3.amazonaws.com/*',
  'https://pinger-prod-vmmessages.s3.amazonaws.com/*',
  'https://pingerprod01usw2-pb-vmmessages.s3.amazonaws.com/*'
];
async function start(scope) {
  const status = document.querySelector('#status');
  for (const b of document.querySelectorAll('button')) b.disabled = true;
  try {
    let media = document.querySelector('#media').checked;
    // Permission requests must occur directly in this user click handler.
    if (media) media = await chrome.permissions.request({origins:mediaOrigins});
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    if (!tab?.url?.startsWith('https://messages.textfree.us/')) throw new Error('Open your signed-in TextFree tab, then click this extension.');
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['core.js','collector.js']});
    const result = await chrome.tabs.sendMessage(tab.id,{type:'TF_EXPORT_START',scope,media});
    if (!result?.ok) throw new Error(result?.error || 'Could not start the exporter.');
    window.close();
  } catch (e) {
    status.textContent = e.message;
    for (const b of document.querySelectorAll('button')) b.disabled = false;
  }
}
document.querySelector('#current').addEventListener('click',()=>start('current'));
document.querySelector('#all').addEventListener('click',()=>start('all'));
