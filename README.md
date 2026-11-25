# IPTV — player for Samsung Tizen 2.4 TVs

A Tizen web app ("IPTV"; package ID `M3uptTvApp`) for 2016 Samsung TVs, e.g. the K series. It loads the
[M3UPT](https://github.com/LITUATUI/M3UPT) playlist and plays its live TV and radio streams.

## Features
- Loads the playlist from `playlistUrl` in `app/js/settings.js` (https://m3upt.com/iptv, which redirects to the M3UPT repo's `M3U/M3UPT.m3u`) on start. If that fails, it uses the last saved copy (localStorage), then the copy bundled in the app, so it still opens offline.
- Groups column (Favourites, All channels, then the playlist's `group-title`s), a channel list with logos, and a preview pane.
- OK plays the channel full screen. Back returns to the list and the channel keeps playing in the preview.
- Full screen: CH+ or Down goes to the next, higher-numbered channel and CH− or Up to the previous one (the arrows follow the list order), within the group you started from, OK or Info shows the banner, and Play/Pause pauses.
- Number keys jump to a channel by its number in the playlist. Red adds or removes a favourite, Green reloads the playlist, Yellow or Stop stops playback, and Blue or PRE-CH returns to the last channel.
- Groups can be hidden: in the Groups column, Red hides or unhides the selected group. Hidden groups disappear from the list, from "All channels" and from zapping, and number entry refuses their channels. The last row, "Show hidden groups", lists them dimmed so they can be unhidden. The defaults are in `app/js/settings.js` (currently Beachcam, Eixo do Mal, PCNELID, IEGCQT, 100 ou Mais, O Planeta Vivo, DRM test); a change made on the TV is saved there until the app is reinstalled.
- Themes: press Info in the channel browser to pick one. Dark: Midnight, Sunset, Forest, Fjord, Espresso, Lagoon, Royal. Black & White and Noir Gold use a pure black background (best on LCD panels, where dark greys show backlight glow) with thin panel edges. Up/Down previews live, OK keeps the choice and Back cancels. The default is `theme` in `app/js/settings.js`. Tizen 2.4's WebKit has no CSS variables, so `app/js/themes.js` builds the colour rules from a palette per theme; layout stays in `style.css`.
- Programme guide (EPG) from `epgUrl` in `app/js/settings.js` (https://m3upt.com/epg, which redirects to the M3UPT repo's `epg-m3upt.xml.gz`: ~3 MB gzip, ~35 MB of XMLTV). The channel list shows what's on under each channel name; the details panel shows now (times, progress bar, description) and next; the full-screen banner shows now with progress, and next. Matching is by the playlist's `tvg-id`. A Web Worker (`epg-worker.js`) inflates the file with pako and scans it as a stream (`epg-parse.js`), keeping only the playlist's channels from 1 h ago to 30 h ahead (~0.65 MB); on the TV that takes about 15 s after launch. The result is cached and refreshed after 6 h (Green also refreshes a guide older than 1 h).
- The remote's **Guide** key opens the full listing for the current channel (the one playing in full screen, otherwise the highlighted one), over the video if it's playing: programmes from 1 h ago to 30 h ahead under day headings, the current one tagged NOW, finished ones dimmed, and the selected programme's time, duration, progress and description beside them. ▲▼ choose a programme (CH+/CH− jump six), ◀▶ change channel, OK watches that channel, Back or Guide closes. (`e` on a desktop keyboard.)
- Logos for the playlist are bundled under `app/logos/` and load locally. If a logo isn't there, it loads from GitHub, and if that fails the row shows the channel's initials.
- `.pls` radio links are resolved to the real stream. The playlist's `#EXTVLCOPT:http-user-agent` (desktop Firefox) is ignored: RTP returns 404 for it, while the TV's own user-agent works everywhere.

## Tizen 2.4 compatibility
- The scripts are plain ES5 with no Promise, fetch, arrow functions, `let`/`const`, `classList`, flexbox or grid. `test/es5-check.js` parses every script as ES5 and fails if it finds a banned API.
- Playback uses Samsung **AVPlay** (`webapis.avplay`), which plays HLS, DASH and MP3/AAC/Icecast in hardware on the video plane. AVPlay's own TLS stack is older than the browser's: it can't connect to hosts that require SNI (CloudFront, used by **SIC**) or to `raw.githubusercontent.com` (where the playlist keeps wrapper `.m3u8` files for **TVI**, **CNN Portugal** and other TVI channels). When AVPlay fails to connect, the app remembers the host, downloads the playlist through the browser, and plays the best variant of a master playlist in AVPlay; otherwise (e.g. SIC's media playlist) it plays the stream in HTML5 `<video>`, which uses the browser's network stack. The first play from such a host takes a few seconds longer. HTML5 `<video>` is also the engine used on desktop browsers without AVPlay.
- The list is virtualised: a fixed pool of 10 rows is reused, so 936 channels don't create 936 DOM rows on the TV's slow CPU.
- Remote keys are registered through `tizen.tvinputdevice`. On Home or Source the player releases the decoder and restarts the stream when you come back.

## Known limits (these come from the platform or the streams, not from the app)
- **ClearKey-encrypted DASH** (RTP 1, RTP 2, SIC and the recorded shows; `#KODIPROP` `license_key=`, `drm_legacy=` or `drm={…}` with the keys) plays, but not through the TV's DRM: Tizen 2.4's AVPlay has no ClearKey, and its prefixed EME accepts ClearKey keys yet passes encrypted samples to the decoder (media error 3). Instead [Shaka Player 2.5](app/js/vendor/README) (the last ES5 build, loaded on first use) streams the DASH segments, `app/js/cenc.js` decrypts each one in software (AES-128-CTR, `cenc` scheme only) in a Web Worker, and the clear MP4 goes to Media Source Extensions. AES runs at about 1.2 MB/s on the TV, so 1080p is fine. These channels are tagged "ClearKey". Other DRM (PlayReady/Widevine, or ClearKey with only a licence URL) shows "Encrypted stream — this TV can't decrypt it".
- Workarounds in that path, each found on this TV or RTP's servers:
  - Tizen 2.4 keeps media time as signed 32-bit milliseconds, so live DASH times past ~24.8 days wrap. The manifest is rewritten to shift the live timeline (`availabilityStartTime` + `presentationTimeOffset`); segment URLs are unchanged.
  - RTP answers a segment requested a moment too early with HTTP 200 and the *previous* segment. Every segment's `tfdt` is checked against the time in its URL and stale ones are refetched (cache-busted).
  - RTP answers `204` (empty) to foreign `Referer`s, so the app sends none (`<meta name="referrer" content="never">`).
- **HEVC (H.265)**: this TV (UE32K5500) can't decode HEVC streams, although its browser reports support: AVPlay and the browser's own player both show a green picture, at every quality (tested 2026-11-25 with CNN Brasil). When an HLS channel starts, the app reads its master playlist in the background: if every video variant is HEVC it stops with "This channel uses HEVC (H.265) video, which this TV can't decode", remembers the URL and tags the channel "HEVC"; if H.264 variants are offered too, it plays the best H.264 one. In the playlist that's CNN Brasil and Love Nature (HEVC only). `hevcSupported: true` in `app/js/settings.js` turns the check off for TVs that decode HEVC.
- AVPlay reports `CONNECTION_FAILED` for dead and encrypted streams too, so a host is only marked "AVPlay can't connect" after the browser fallback has actually played from it.
- AVPlay can't send `Referer`/`Origin` headers. Testing on 2026-11-21 showed that only one TV channel (AgroBrasil TV) refuses requests without them.
- Groups such as *Eixo do Mal* and *PCNELID* are recorded episodes (VOD), not live channels. They play, and Play/Pause works on them.
- The 27 entries whose URL is commented out in the playlist are disabled upstream and are skipped.

## Icon
`app/icon.png` is a 512×288 (16:9) full-bleed launcher image (play badge + "IPTV" wordmark in Noto Sans Black) rendered from `art/icon.svg`
(`rsvg-convert -w 512 -h 288 -o app/icon.png art/icon.svg`). The 2016 home bar and favourites tile are
landscape, so a square or 512×423 icon gets stretched there (same approach as the apps in samsung-tv).

## Build and install
```sh
npm install            # dev tools only: acorn + playwright-core for the tests
npm test               # ES5 check, parser test, headless UI walk-through (screenshots in test/shots/)
npm run test:online    # plays the live ClearKey RTP 1 stream through Shaka + cenc.js in desktop Chromium
tools/update-data.sh   # refresh the bundled playlist and logos from GitHub
tools/build.sh         # unsigned build/M3UPTTV.wgt (signed by install-via-asus.sh)
tools/build.sh <cert-profile>   # signed, needs Tizen Studio's `tizen` CLI on PATH
```
To install on the TV (UE32K5500, Developer Mode, developer IP = asus-arch):
```sh
tools/install-via-asus.sh   # build → sign on asus-arch → push → vd_appinstall
```
The script signs with a dedicated author certificate in `~/.local/share/m3upt-tv-signing/` on asus-arch
(keep it; updates must use the same author key) and the public Tizen distributor certificate.
It stages the package in `/opt/usr/apps/tmp/` under a fresh name (`/home/owner/share/tmp/sdk_tools`
is not writable on this TV) and checks for `install completed`.

Signing is required: an unsigned package is rejected with installer error 118 (tested 2026-11-21).
Error 118 was also caused by a non-ASCII file name in the package (`Antena1-Açores.png`);
`tools/update-data.sh` now only bundles ASCII-named logos and the rest load from GitHub.

## Tools
- `tools/install-via-asus.sh`: build, sign on asus-arch, install on the TV (`REINSTALL=1` to uninstall first, needed for updates on this TV).
- `tools/inspect.js '<js>' [port]`: evaluate JavaScript in the app on the TV through the Web Inspector. Start the app with `sdb shell 0 debug M3uptTvApp.M3UPTTV 300`; it prints the port (7011 or 7012).
- `tools/sdb`: Tizen's x86-64 `sdb` run through qemu-user on an aarch64 host. Run `tools/fetch-sdb.sh` once to download it. The TV only accepts sdb from its developer IP, so use it through an SSH tunnel via that host.

## Credits
The bundled playlist (`app/data/M3UPT.m3u`) and channel logos (`app/logos/`) come from
[LITUATUI/M3UPT](https://github.com/LITUATUI/M3UPT) (MIT License); logos remain the property of their owners.

