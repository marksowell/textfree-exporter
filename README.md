# TextFree Local Exporter

A small, local Chrome extension built against the TextFree Web interface inspected on September 21, 2026. No account password, API token, remote service, analytics, or production dependencies are required.

**Experimental:** version **0.2.2** supports both observed TextFree voicemail storage hosts. The updated downloader has saved and validated two real WAV recordings. Try a conversation with voicemail and check its offline audio before running the full inbox.

## Install and use

1. On GitHub, choose **Code → Download ZIP**, then unzip the download. You can also use a separately packaged `textfree-exporter.zip`.
2. Open `chrome://extensions` in Chrome and enable **Developer mode**.
3. Click **Load unpacked** and choose the extracted folder containing `manifest.json` (usually `textfree-exporter-main`).
4. Return to your signed-in `https://messages.textfree.us` tab. Open a conversation.
5. Open Chrome’s Extensions menu (the puzzle-piece icon), then **TextFree Local Exporter**.
6. Start with **Export current conversation**. If you leave **Download attachments and voicemail audio** enabled, Chrome asks for access to the three supported TextFree media storage hosts. Declining still allows text exports.
7. Keep the TextFree tab open and avoid changing conversations while it runs. Use the on-page **Download ZIP** button when capture finishes.
8. Unzip the resulting archive and open **index.html**. Check **report.json**, then use **Export entire inbox** for the full available web history.

The extension opens conversations and scrolls the inbox and each chat to load older history. This may mark conversations as read. To capture voicemail audio, it clicks the voicemail Play controls while briefly intercepting their recording links; this **may mark voicemails as listened to**. It saves the files without playing audio or opening a tab for each recording. It never types into the message composer, sends messages, deletes conversations, changes account settings, or follows links inside messages. **Stop and keep progress** preserves the current capture; click **Download ZIP** afterward. Refreshing or closing TextFree discards any capture you have not downloaded. The extension can be removed from Chrome after use.

### Version 0.2.2

Adds the second voicemail host observed in TextFree Web, `pingerprod01usw2-pb-vmmessages.s3.amazonaws.com`, alongside the older `pinger-prod-vmmessages.s3.amazonaws.com` host. Version 0.2.1 could capture a link on the second host but rejected it as unsupported. The popup now requests its optional download permission, and the downloader applies the same path, format, and size checks to both voicemail hosts. Unsupported-host errors now name the host without exposing the private recording path.

### Version 0.2.1

Fixes a voicemail capture check that compared each conversation URL with Chrome's content-script sender URL. Chrome can retain the original sender URL while TextFree moves between conversations without a reload, causing `Invalid voicemail request` before any audio link is captured. The exporter now validates the sender's origin and checks the actual page URL and voicemail record inside the page immediately before clicking. Failed capture details are returned explicitly and the completion panel lists the most common voicemail failure reasons.

### Updating an existing installation

Download any finished capture before refreshing TextFree. Replace the extension files with the latest download, click **Reload** for TextFree Local Exporter on `chrome://extensions`, then refresh the TextFree tab. Start a new export with media downloading enabled and allow the new voicemail host permission. Existing ZIP archives do not gain recordings automatically.

## Files in an exported archive

- `index.html`: readable offline conversation archive, searchable with Chrome’s Find command and printable to PDF.
- `archive.json`: structured conversations and records, including displayed dates/times, directions, transcripts, reactions, links, and attachment status.
- `report.json`: pagination results, failures, missing media, and conversations requiring review.
- `attachments/`: successfully downloaded media files, including voicemail `.wav` recordings. The offline HTML includes playback and download controls for each saved recording.

## Coverage and limits

**This is not a guaranteed “everything in my account” backup. Do not delete the account until you have checked the archive and saved any missing items separately.**

- Captures only data made available by TextFree Web. Deleted, expired, app-only, and otherwise unavailable content cannot be recovered.
- Voicemail transcripts, displayed durations, and accessible WAV recordings are captured. The website opens recordings through its Play button rather than exposing an audio element in the chat. The exporter captures that link only during the synchronous click and restores normal browser behavior immediately. A conversation and record check prevents capturing from a different chat. If the site changes its player, a link is missing, or a file is inaccessible, the recording remains explicitly listed as missing and the transcript is kept.
- Downloads are restricted to the observed TextFree locations: `https://pingerprod01usw2-pb-mmspics.s3.amazonaws.com/communications/` for attachments, plus `https://pinger-prod-vmmessages.s3.amazonaws.com/vmmessages/` and `https://pingerprod01usw2-pb-vmmessages.s3.amazonaws.com/vmmessages/` for voicemail. Voicemail downloads are checked for a WAV file signature. Other locations, inaccessible files, and unsupported formats are recorded as missing. Regular hyperlinks in messages are never fetched.
- The report separately counts voicemail recordings saved and missing. The total media-file count includes voicemail audio; “discovered files not saved” counts failed or skipped URLs, while the missing-voicemail count also includes recordings for which no URL was found.
- Media is limited to 20 MB per file and 200 MB per archive to keep Chrome responsive. Text and missing-file references are retained when a limit is reached. You can export conversations individually to reduce archive size.
- Dates and times are the site’s displayed values. No timezone or exact server timestamp is invented. Sender direction is `unknown` when the DOM does not provide enough evidence.
- Repeated identical messages are preserved. Previously visited, hidden chat pages are excluded.
- The tool loads the inbox in batches and older messages until the site disables its pagination control. `exhausted` means the website stopped offering older items, not that the server’s complete account data was independently verified. Missing controls, stalls, navigation failures, cancellations, and unknown message types are reported.
- Large text histories remain in browser memory until downloaded. No resumable checkpoint is written to browser storage. Stop and download partial progress if needed.

## Validation

Live page inspection verified active vs. hidden chat selectors, message and call markup, displayed timestamps, voicemail transcripts, image URLs, the Ionic shadow-DOM scroll area, inbox pagination, and a voicemail recording opened by the site's Play control. A user-provided recording URL on the older host returned HTTP 200 with WAV content. For 0.2.2, the actual downloader code fetched two live recordings from the second host; both files passed WAV signature and full PCM payload checks. This exercised the downloader outside Chrome; extension permission prompts and a complete live export still need user verification. This repository contains only source code and synthetic test fixtures; no personal conversations, recording URLs, or account exports are included.

Automated tests cover parsing, duplicate preservation, hidden-page isolation, unknown records, missing audio, ZIP integrity, HTML escaping, inbox/history pagination, stalled history, cancellation, navigation failure, restricted media fetching, voicemail link capture and restoration, record mismatch guards, voicemail download success and failure, and stale sender URLs after conversation navigation. Tests use synthetic data. The complete 0.2.2 flow has **not yet been verified through the installed extension on a live inbox**. Begin with a single-conversation export and verify offline playback.

For development only, with Node.js 22+ and Python 3 available:

```sh
npm ci
npm test
```

No build step is required to load the extension. Test dependencies are not used by the extension.

## Implementation

- `core.js`: pure DOM extraction, safe HTML rendering, coverage report, and dependency-free ZIP writer.
- `collector.js`: on-demand, isolated content script; navigates conversation labels and Ionic scroll areas, with stop and download controls.
- `background.js`: validates attachment source and performs bounded GET requests without credentials or redirects.
- `voicemail.js`: short-lived MAIN-world Play-button link capture, invoked by the background worker for the active conversation only. Does not read private application state, credentials, or tokens.
- `popup.*`: user-invoked entry point and optional media permission.

Chrome permissions are limited to `activeTab`, `scripting`, and optional access to the three observed media hosts. The extension is not affiliated with TextFree or Pinger. Source documentation: [Chrome scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting), [extension cross-origin requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests), and [optional permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions).
