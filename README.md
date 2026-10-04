<p align="center"><img src="icon128.png" width="96" height="96" alt=""></p>

<h1 align="center">Stream Scout</h1>

<p align="center"><b>Find the video on any page. Watch it without the clutter, send it to your TV, or save it.</b></p>

<p align="center">
  <a href="https://github.com/RadekCihlar/free-video-caster/releases/latest/download/stream-scout-chromium.zip"><img alt="Download for Chrome, Edge, Opera, Brave and Vivaldi" src="https://img.shields.io/badge/Download-Chrome%20%C2%B7%20Edge%20%C2%B7%20Opera%20%C2%B7%20Brave-7c4fd6?style=for-the-badge"></a>
  <a href="https://github.com/RadekCihlar/free-video-caster/releases/latest/download/stream-scout-firefox.zip"><img alt="Download for Firefox" src="https://img.shields.io/badge/Download-Firefox-7c4fd6?style=for-the-badge"></a>
</p>

<p align="center">
  <a href="https://github.com/RadekCihlar/free-video-caster/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/RadekCihlar/free-video-caster?color=7c4fd6"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-7c4fd6"></a>
  <a href="PRIVACY.md"><img alt="No tracking" src="https://img.shields.io/badge/tracking-none-7c4fd6"></a>
</p>

---

Stream Scout is a free, open-source browser extension. It watches the page you have open for video files, HLS playlists, DASH manifests and subtitle tracks, and lists them in one small popup. From there, one click:

- **▶ Play** the stream in a clean player tab, without the page's ads, overlays and pop-ups.
- **📺 Cast** it to a Chromecast or Google TV. The TV fetches the stream itself, so it plays at full quality, your computer stays free, and nothing is mirrored.
- **🍎 AirPlay** it to an Apple TV or AirPlay speaker when you use Safari.
- **⬇ Save** it through the browser's own download manager.

No account, no server, no tracking. Everything runs in your browser.

## Features

- **Finds streams as they load**, including ones the page fetches in the background, with a count on the toolbar icon.
- **Quality picker** for HLS playlists, so you choose 1080p instead of whatever the page guessed.
- **Real titles.** Videos are named after the tab, not after a meaningless file name.
- **Subtitles** are collected from the page and sent to the TV with the video.
- **TV remote** in the player and in the popup: play and pause, seek, playback speed, switch subtitles, stop.
- **Device detection.** The Cast button finds Chromecast and Google TV devices on your network. In browsers without Cast, a **Play on device** button (**AirPlay** in Safari) appears as soon as the browser sees a nearby device.
- **Clear errors.** Problems show up as short messages in the top-right corner that say what went wrong.

## Install

Pick your browser. It takes about a minute.

### Chrome, Edge, Opera, Opera GX, Brave, Vivaldi

1. [**Download `stream-scout-chromium.zip`**](https://github.com/RadekCihlar/free-video-caster/releases/latest/download/stream-scout-chromium.zip) and unzip it.
2. Open the extensions page: `chrome://extensions`, `edge://extensions`, `opera://extensions`, `brave://extensions` or `vivaldi://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and choose the unzipped folder, the one that contains `manifest.json`.
5. Pin Stream Scout to the toolbar.

In Opera and Opera GX, also open `opera://settings`, search for **Chromecast** and turn it on.

Browsers only allow one-click installs from their own stores. Store listings are on the way; until then this is the way to install.

### Firefox

1. [**Download `stream-scout-firefox.zip`**](https://github.com/RadekCihlar/free-video-caster/releases/latest/download/stream-scout-firefox.zip).
2. Open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…** and choose the zip.

Firefox removes temporary add-ons when it restarts. To keep it installed, use Firefox Developer Edition or Nightly, set `xpinstall.signatures.required` to `false` in `about:config`, rename the zip to `stream-scout.xpi` and install it from `about:addons` → ⚙ → **Install Add-on From File…**. Firefox has no Chromecast support, so casting is not available there; play and save work as usual.

### Safari (experimental)

Safari extensions have to be wrapped in a Mac app. On a Mac with Xcode, run `xcrun safari-web-extension-converter` on the unzipped Chromium folder, build the generated project and enable Stream Scout in Safari's settings. This path is untested. In Safari, the player shows an **AirPlay** button for your Apple TV and AirPlay speakers.

### Updating

Download the new zip, replace the folder's contents and press the reload button on Stream Scout's card in the extensions page.

## What works where

| Browser | Chromecast | AirPlay |
| --- | --- | --- |
| Chrome, Edge, Opera, Brave, Vivaldi | ✅ | — |
| Firefox | — | — |
| Safari (experimental) | — | ✅ |

Detect, play and save work in all of them. Brave turns Cast off by default; turn on **Media Router** in `brave://settings/extensions` to cast.

## How to use it

1. Open the page with the video and start playing it, so the page loads the stream.
2. Click the Stream Scout icon. Each stream it found is listed with its quality.
3. Choose what to do:
   - **Open in player** plays it in a new tab. Pick the quality, subtitles and speed there.
   - **Cast to TV** opens the player. Press **Cast to TV** in the top-right corner of the video and choose your TV. Casting starts from that button because browsers only open the device picker after a click on the page itself.
   - **Download** asks where to save the file.
4. While casting, control the TV from the player tab or the popup. Keep the player tab open: if it closes, the TV keeps playing but the remote stops working.

Nothing listed? Start the video and press the refresh button in the popup.

## How it works

- A content script and a small page script notice video and subtitle addresses as the page requests them, and read `<video>` and `<track>` elements. The background worker also checks response headers to recognise media files without a telling file extension.
- For HLS playlists and DASH manifests, the background worker requests the file once more from the same site to read its qualities and subtitle tracks.
- Found streams are kept per tab in the browser's session storage and cleared when the tab navigates or closes.
- The player is an ordinary extension page that uses the browser's built-in video player.
- **Chromecast** uses Google's Cast library, bundled unchanged in `vendor/cast/` and loaded only inside a sandboxed frame in the player page. It sends the stream address, title and subtitles to the TV's Default Media Receiver, which fetches and plays the stream.
- **AirPlay and other devices** use the browser's standard [Remote Playback API](https://developer.mozilla.org/docs/Web/API/Remote_Playback_API). The button only appears when the browser reports a device nearby.
- Downloads go through the browser's download manager with a save dialog.

No code is loaded from the internet. [PRIVACY.md](PRIVACY.md) lists exactly what is read and where it goes.

### Permissions

| Permission | Why |
| --- | --- |
| Access to all sites, `webRequest` | Notice video and subtitle files as pages load them. |
| `storage` | Keep the list of found streams for the current session. |
| `downloads` | Save a stream when you press Download. |

## Limits

- **The TV fetches the stream itself.** Streams that only work with the browser's cookies or a specific referrer play in the browser but fail on the TV.
- **Links expire.** Many streams use signed addresses that stop working after a while. If casting fails, reload the page and try again.
- **Subtitle formats.** The player shows WebVTT subtitles, and only WebVTT and TTML can be cast. SRT tracks are not cast.
- **Stream formats in the player.** Whether HLS and DASH play in the player tab depends on the browser's own support; casting them works regardless.
- **Other TVs.** Smart TVs that only speak DLNA or a vendor protocol can't be reached from a browser extension.
- **No DRM.** Protected streams cannot be played, cast or saved. Stream Scout does not extract keys or work around licence systems; use the service's own app or Cast button.

## Responsible use

Stream Scout works with the addresses a page already gives your browser. Only play, cast or save content you have the right to. Respect the terms of the sites you use and the copyright of the people who made the content.

## Contributing

No build step and no dependencies: the repository is the extension. Load the folder unpacked as above, make your change, and press reload on the extension's card. Bug reports and pull requests are welcome in [Issues](https://github.com/RadekCihlar/free-video-caster/issues).

## License

[MIT](LICENSE) © Radek Cihlář. The bundled Google Cast library in `vendor/cast/` belongs to Google and is covered by the [Google Cast SDK terms](https://developers.google.com/cast/docs/terms), not the MIT license.
