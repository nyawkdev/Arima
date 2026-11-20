<p>
  <img src="site/assets/logo.png" alt="Arima logo" width="56" height="56" />
</p>

# Arima

SoundCloud desktop client for Windows in a single portable executable.

<p>
  <a href="https://github.com/nyawkdev/Arima/releases/latest">
    <img src="https://img.shields.io/github/v/release/nyawkdev/Arima?style=flat&color=141418&labelColor=0a0a0c" alt="Latest Release" />
  </a>
  <img src="https://img.shields.io/badge/platform-Windows%2010%2F11%20x64-0a0a0c?style=flat" alt="Windows 10/11 x64" />
  <img src="https://img.shields.io/badge/stack-Tauri%20v2%20%2F%20SvelteKit%20%2F%20Rust-0a0a0c?style=flat" alt="Tauri v2 / SvelteKit / Rust" />
</p>

[Website](https://nyawkdev.github.io/Arima/) / [Download Arima.exe](https://github.com/nyawkdev/Arima/releases/latest) / [Issues](https://github.com/nyawkdev/Arima/issues)

<img src="site/assets/screenshots/1.png" alt="Arima Home and Themes" width="100%" />

<table>
  <tr>
    <td width="50%">
      <img src="site/assets/screenshots/2.png" alt="Arima Now Playing and Lyrics" width="100%" />
    </td>
    <td width="50%">
      <img src="site/assets/screenshots/3.png" alt="Arima Audio and Settings" width="100%" />
    </td>
  </tr>
</table>

## Features

- Dark, light, and system themes with preset color palettes, custom colors, and cover-based theme colors
- Floating mini-player overlay (Island, Pill, Mini) with fullscreen auto-hide and `Ctrl+Alt+I` hotkey
- 5-band equalizer, preamp, Bass Boost, and playback modes (Slowed, Slowed + Reverb, Speed Up, Nightcore)
- Synced lyrics viewer with click-to-seek
- Windows media controls (SMTC) with cover art and Discord Rich Presence
- Local listening history, stream cache, proxy support, and single portable `Arima.exe`

## Download

Download `Arima.exe` from [Releases](https://github.com/nyawkdev/Arima/releases/latest) or the [project site](https://nyawkdev.github.io/Arima/). Requires Windows 10/11 (x64) with WebView2 Runtime, no installer needed.

## Build from source

```bash
npm install
npm run check
npm run lint:design
npm run tauri dev
```

Portable Windows build:

```bash
npx tauri build --no-bundle
```

The output binary is written to `src-tauri/target/release/arima.exe`.

## Data and reset

| Data | Location |
| --- | --- |
| Settings and SQLite DB | `%APPDATA%\app.arima.desktop` |
| Audio and WebView cache | `%LOCALAPPDATA%\app.arima.desktop` |
| SoundCloud OAuth token | Windows Credential Manager (`arima` / `soundcloud-oauth`) |

Full reset is also available inside the app under **Settings -> General -> Cache and network -> Reset Arima**.
