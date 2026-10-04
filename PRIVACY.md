# Privacy policy

Last updated: 4 October 2026

Stream Scout has no servers, no accounts, no analytics and no tracking. It does not sell or share data with anyone.

## What it reads

To find videos and subtitles, Stream Scout looks at the pages you visit, in your browser only:

- the addresses of video, playlist and subtitle files that a page loads or links to, and the response headers that say what kind of file they are
- `<video>` and `<track>` elements on the page
- the title and address of the active tab, so the video can be named in the popup, the player and on your TV

Nothing else on the page is read: no form fields, passwords, cookies or browsing history.

## Where it keeps it

The list of streams found on each tab is kept in the browser's session storage (`chrome.storage.session`). It is removed when the tab navigates away or closes, and the browser clears all of it when it quits.

The subtitle look you pick in the player (font, size, color and background) is kept in the browser's local storage (`chrome.storage.local`) so it stays the same next time. Subtitle files you add from your PC are read only while the player tab is open and are never stored. Nothing else is written to disk by Stream Scout, and nothing is synced.

## What leaves your browser

Stream Scout never contacts a server of its own. Its only requests go to the sites the streams come from, or to your TV:

- **Reading playlists.** When a page loads an HLS playlist or DASH manifest, Stream Scout requests the same file once more from the same site, with that site's cookies, as the page itself did. It reads the list of qualities and subtitle tracks from it and nothing else.

Everything else happens only when you ask for it:

- **Play.** The extension's player page loads the stream from the site that serves it, exactly as the original page would.
- **Cast.** When you press "Cast to TV" and pick a device, the stream address, the video title and the subtitle addresses are sent to that Cast device (for a subtitle file added from your PC, or subtitles with shifted timing, the subtitle text itself) on your network, which then loads the stream itself. This uses Google's Cast library, bundled with the extension, and the browser's built-in Cast support. Google's handling of Cast data is covered by [Google's privacy policy](https://policies.google.com/privacy).
- **AirPlay and other devices.** When you press "AirPlay" or "Play on device" and pick a device, the browser itself sends the stream to that device through its built-in Remote Playback support. Stream Scout only asks the browser to open its device picker and whether a device is nearby; it never sees the device list.
- **Save.** Downloads go through the browser's own download manager, which shows a save dialog first.

## Permissions

- `webRequest` and access to all sites: to notice video and subtitle files as pages load them, on any site you choose to use the extension with.
- `storage`: to keep the per-tab stream list for the current session, and your subtitle look.
- `downloads`: to save a stream when you press the download button.

## Contact

Questions or concerns: open an issue at https://github.com/RadekCihlar/free-video-caster/issues.
