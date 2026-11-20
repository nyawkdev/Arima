# Arima

Minimalist OLED-first SoundCloud desktop player for Windows built with Tauri v2, SvelteKit 5, and Rust.

## Features

- **AMOLED & Dynamic Themes**: Pure `#000000` OLED aesthetic with preset palettes, custom accent colors, and adaptive cover-art theming.
- **Dynamic Island Overlay**: Floating mini-player (`Island`, `Pill`, `Mini`) with fullscreen auto-hide and global hotkey (`Ctrl+Alt+I`).
- **Real-Time Audio Engine**: 5-band equalizer, preamp, Slowed, Slowed + Reverb, Speed Up, Nightcore, and Bass Boost.
- **Synced Lyrics**: Word-by-word and line-by-line synced lyrics with instrumental gap indicators.
- **Windows SMTC & Discord RPC**: Native Windows media controls/artwork integration and Discord Rich Presence with AI-cleaned metadata.
- **Portable & Lightweight**: Single-file Windows `.exe` with aggressive background memory trimming and local SQLite + stream caching.

## Download

Grab the latest portable Windows build (`Arima.exe`) from the [Releases](../../releases/latest) page. No installer required — requires Windows 10/11 (WebView2 Runtime).

## Development

```bash
npm install
npm run check
npm run lint:design
npm run tauri dev
```

Build portable executable:

```bash
npx tauri build --no-bundle
```

The compiled portable binary will be at `src-tauri/target/release/arima.exe`.

## App Data & Reset

- Settings & database: `%APPDATA%\app.arima.desktop`
- Audio & WebView cache: `%LOCALAPPDATA%\app.arima.desktop`
- SoundCloud token: Windows Credential Manager (`arima` / `soundcloud-oauth`)

You can also perform a full reset directly from **Settings → General → Cache & network → Reset Arima**.
