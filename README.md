# TextFree Local Exporter

Save messages, call history, voicemail transcripts, and accessible recordings from TextFree Web in a local ZIP archive. Read conversations offline, play saved audio, and keep the structured data for your own records.

The extension runs locally. It does not require an account password, API token, remote service, or production dependencies, and has no analytics. It is not affiliated with TextFree or Pinger.

## Install and export

1. Choose **Code → Download ZIP** on GitHub, then extract the download. You can also use the packaged `textfree-exporter.zip`.
2. Open `chrome://extensions`, enable **Developer mode**, and click **Load unpacked**. Select the folder containing `manifest.json`.
3. Return to your signed-in `https://messages.textfree.us` tab and open a conversation.
4. Open **TextFree Local Exporter** from Chrome’s Extensions menu. Start with **Export current conversation**.
5. Leave **Include media** checked to save attachments and voicemail audio. Allow access to the supported TextFree media hosts when prompted. Declining still allows a text export.
6. Keep TextFree open and avoid changing conversations during capture. Click **Download ZIP** when it finishes.
7. Extract the ZIP and open **index.html**. Use the conversation index to navigate and your browser’s Find command to search. Audio players and download links use the saved local files.

Use **Export entire inbox** to capture all conversations available through the web interface. The exporter scrolls the inbox and each conversation to load older history. **Stop and keep progress** retains the current capture so you can download a partial archive.

Opening conversations may mark them as read. Capturing voicemail audio uses the site’s Play controls and may mark recordings as listened to. The exporter does not send messages, delete conversations, or change account settings.

### Updating

Save any finished capture before refreshing TextFree. Replace the extension files, click **Reload** on `chrome://extensions`, then refresh the TextFree tab. New media hosts may require an additional optional permission. The new reader layout applies to new exports; existing ZIP files keep their original HTML.

## The archive

- **index.html** — a responsive reader with a conversation sidebar, date dividers, call entries, voicemail playback, and transcripts. It works offline without JavaScript or external fonts and supports printing to PDF.
- **archive.json** — structured conversations and records, including displayed dates, times, directions, durations, transcripts, reactions, and media status.
- **report.json** — capture scope, history-loading results, missing files, and export notes.
- **attachments/** — downloaded images, documents, and recordings, including voicemail WAV files.

The conversation sidebar shows the total activity count so you can spot busy threads. Conversation headings break that count into messages, calls, and voicemails. A voicemail’s transcript and recording count together as one entry. Missed calls remain visible in the history but are excluded from activity counts. The JSON report retains a separate count of all captured records.

Web links in messages and transcripts are clickable and open in a new tab. Captured link destinations are preserved; plain-text HTTP, HTTPS, and `www.` addresses are linked automatically. Linked websites are not downloaded into the archive.

The reader keeps routine export details in a collapsible section. Missing files and incomplete history produce specific notes in the relevant conversation. A successful capture does not show a generic warning banner.

## Coverage and limits

An export includes history available through TextFree Web at capture time. It cannot recover deleted, expired, app-only, or otherwise unavailable content.

- **History:** the exporter loads older items until TextFree disables its pagination control. An `exhausted` result means the website stopped offering more pages; it does not independently verify all data held by the service. Missing controls, stalled loading, navigation failures, and cancellations are recorded in the report.
- **Voicemail:** transcripts, displayed durations, and accessible WAV recordings are saved. TextFree opens the recording through its Play button. The exporter briefly captures that link, restores normal behavior, and downloads the file without opening a tab for each recording. If capture or download fails, the transcript is retained with a specific note.
- **Media:** files are limited to 20 MB each and 200 MB per archive. When a limit is reached, text and missing-file references are retained. Export individual conversations to reduce the archive size.
- **Dates and times:** values shown by TextFree are preserved. No message timezone or precise server timestamp is inferred. The export timestamp is shown separately in UTC.
- **Duplicates:** repeated identical messages are preserved. Previously visited, hidden conversation pages are excluded.
- **Progress:** capture remains in memory until downloaded. Refreshing or closing TextFree discards any unsaved capture. There is no resumable checkpoint.

Downloads are limited to the observed TextFree locations:

- `https://pingerprod01usw2-pb-mmspics.s3.amazonaws.com/communications/`
- `https://pinger-prod-vmmessages.s3.amazonaws.com/vmmessages/`
- `https://pingerprod01usw2-pb-vmmessages.s3.amazonaws.com/vmmessages/`

Downloads use HTTPS GET requests without credentials or redirects. WAV recordings are checked for their file signature. Unsupported locations and formats are reported; regular hyperlinks in messages are never fetched.

## Recent changes

- **0.3.3:** preserve clickable web links in messages and transcripts, including plain-text URLs.
- **0.3.2:** exclude missed calls from activity counts while preserving them in the history.
- **0.3.1:** activity counts in the sidebar with clear message, call, and voicemail breakdowns.
- **0.3.0:** redesigned offline reader, compact call entries, clearer audio controls, responsive conversation navigation, and neutral export copy.
- **0.2.2:** support for the second observed voicemail storage host.
- **0.2.1:** corrected voicemail capture after conversation navigation and surfaced precise failure reasons.

## Development and validation

With Node.js 22+ and Python 3:

```sh
npm ci
npm test
```

No build step is required. Test dependencies are not used by the extension.

Tests cover DOM extraction, duplicate preservation, hidden-page isolation, navigation and pagination failures, cancellation, voicemail link capture, both supported voicemail hosts, media validation, archive rendering, HTML escaping, and ZIP integrity. The reader is also checked in Chrome using synthetic conversations at desktop and mobile widths.

A live single-conversation export has saved both voicemail recordings with zero missing files. That confirms the tested flow, not the completeness of every account export. This repository contains source code and synthetic fixtures only; no personal conversations, recording URLs, or account exports are included.

- `archive-view.js`: offline HTML reader and embedded styles.
- `core.js`: DOM extraction, coverage report, HTML escaping, and ZIP writer.
- `collector.js`: conversation navigation, history loading, capture progress, and ZIP download.
- `background.js`: media validation and bounded downloads.
- `voicemail.js`: brief Play-button link capture in the page’s main JavaScript context.
- `popup.*`: export options and optional media permissions.

Chrome permissions are limited to `activeTab`, `scripting`, and optional access to the three media hosts above. See the Chrome documentation for [scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting), [cross-origin requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests), and [optional permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions).
