# TextFree Local Exporter

A small, local Chrome extension built against the TextFree Web interface inspected on September 21, 2026. No account password, API token, remote service, analytics, or production dependencies are required.

**Experimental:** source and synthetic tests are available, but a complete live-account export has not yet been validated. Try one conversation and review the coverage report before using the full-inbox export.

## Install and use

1. On GitHub, choose **Code → Download ZIP**, then unzip the download. You can also use a separately packaged `textfree-exporter.zip`.
2. Open `chrome://extensions` in Chrome and enable **Developer mode**.
3. Click **Load unpacked** and choose the extracted folder containing `manifest.json` (usually `textfree-exporter-main`).
4. Return to your signed-in `https://messages.textfree.us` tab. Open a conversation.
5. Open Chrome’s Extensions menu (the puzzle-piece icon), then **TextFree Local Exporter**.
6. Start with **Export current conversation**. If you leave attachment downloading enabled, Chrome asks for access to the supported TextFree media storage host. Declining still allows text exports.
7. Keep the TextFree tab open and avoid changing conversations while it runs. Use the on-page **Download ZIP** button when capture finishes.
8. Unzip the resulting archive and open **index.html**. Check **report.json**, then use **Export entire inbox** for the full available web history.

The extension opens conversations and scrolls the inbox and each chat to load older history. This may mark conversations as read. It never types into the message composer, sends messages, deletes conversations, changes account settings, or follows links inside messages. **Stop and keep progress** preserves the current capture; click **Download ZIP** afterward. Refreshing or closing TextFree discards any capture you have not downloaded. The extension can be removed from Chrome after use.

## Files in an exported archive

- `index.html`: readable offline conversation archive, searchable with Chrome’s Find command and printable to PDF.
- `archive.json`: structured conversations and records, including displayed dates/times, directions, transcripts, reactions, links, and attachment status.
- `report.json`: pagination results, failures, missing media, and conversations requiring review.
- `attachments/`: successfully downloaded media files. These are local files, not remote image references.

## Coverage and limits

**This is not a guaranteed “everything in my account” backup. Do not delete the account until you have checked the archive and saved any missing items separately.**

- Captures only data made available by TextFree Web. Deleted, expired, app-only, and otherwise unavailable content cannot be recovered.
- Voicemail transcripts and durations are captured. In the inspected interface, voicemail audio was not exposed as a downloadable DOM media URL—even after opening a voicemail. Those records explicitly state that audio is missing. The exporter does not play voicemails.
- Attachment download support is restricted to `https://pingerprod01usw2-pb-mmspics.s3.amazonaws.com/communications/`, the media location observed in the live page. Other locations, inaccessible files, and unsupported formats are recorded as missing. Regular hyperlinks in messages are never fetched.
- Media is limited to 20 MB per file and 200 MB per archive to keep Chrome responsive. Text and missing-file references are retained when a limit is reached. You can export conversations individually to reduce archive size.
- Dates and times are the site’s displayed values. No timezone or exact server timestamp is invented. Sender direction is `unknown` when the DOM does not provide enough evidence.
- Repeated identical messages are preserved. Previously visited, hidden chat pages are excluded.
- The tool loads the inbox in batches and older messages until the site disables its pagination control. `exhausted` means the website stopped offering older items, not that the server’s complete account data was independently verified. Missing controls, stalls, navigation failures, cancellations, and unknown message types are reported.
- Large text histories remain in browser memory until downloaded. No resumable checkpoint is written to browser storage. Stop and download partial progress if needed.

## Validation

Live page inspection verified active vs. hidden chat selectors, message and call markup, displayed timestamps, voicemail transcripts, image URLs, the Ionic shadow-DOM scroll area, and inbox pagination. This repository contains only source code and synthetic test fixtures; no personal conversations or account exports are included.

Automated tests cover parsing, duplicate preservation, hidden-page isolation, unknown records, missing audio, ZIP integrity, HTML escaping, inbox/history pagination, stalled history, cancellation, navigation failure, and restricted media fetching. Tests use synthetic data. The complete extension has **not yet been installed or run against the full live inbox**, and actual attachment downloads have not been verified. Begin with a single-conversation export.

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
- `popup.*`: user-invoked entry point and optional media permission.

Chrome permissions are limited to `activeTab`, `scripting`, and optional access to the single observed media host. The extension is not affiliated with TextFree or Pinger. Source documentation: [Chrome scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting), [extension cross-origin requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests), and [optional permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions).
