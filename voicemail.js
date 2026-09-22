// Runs briefly in the page's MAIN world so the site's Play handler can expose its
// recording URL. This function must be self-contained for chrome.scripting.
function captureVoicemailLink(request) {
  'use strict';
  const text = el => (el?.textContent || '').replace(/[\uE000-\uF8FF]/g, '').trim();
  if (location.origin !== 'https://messages.textfree.us' || location.href !== request.pageUrl) {
    throw new Error('Conversation changed before voicemail capture');
  }
  const pages = [...document.querySelectorAll('communications-detail-page')]
    .filter(el => !el.closest('.ion-page-hidden,.ion-page-invisible,[aria-hidden="true"]'));
  if (pages.length !== 1) throw new Error('Could not identify the active voicemail conversation');
  const container = pages[0].querySelector('.messages-container');
  const nodes = [...(container?.children || [])].filter(el => el.tagName.toLowerCase() === 'sc-voice-mail-message');
  const node = nodes[request.ordinal];
  if (!node || text(node.querySelector('.voicemail-time')) !== request.expected.duration ||
      text(node.querySelector('.message-time')) !== request.expected.time ||
      text(node.querySelector('.voicemail-transcription-text')) !== request.expected.transcript) {
    throw new Error('Voicemail changed before capture; export this conversation again');
  }
  const button = node.querySelector('button[data-testid="voicemail-msg-bubble"]');
  if (!button || button.disabled) throw new Error('Voicemail Play button is unavailable');
  const originalOpen = window.open;
  const urls = [];
  const captureOpen = url => { if (typeof url === 'string') urls.push(url); return null; };
  try {
    // TextFree calls window.open synchronously from this button's click handler.
    // Capture only during this click; no persistent hook, audio playback, or tabs.
    window.open = captureOpen;
    if (window.open !== captureOpen) throw new Error('Could not capture the voicemail link');
    button.click();
  } finally {
    window.open = originalOpen;
  }
  if (location.href !== request.pageUrl) throw new Error('Conversation changed during voicemail capture');
  const unique = [...new Set(urls)];
  if (unique.length !== 1) throw new Error('TextFree did not expose one recording link from the Play button');
  return unique[0];
}

if (typeof module !== 'undefined') module.exports = {captureVoicemailLink};
