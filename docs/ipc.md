# Arima IPC contract (Rust ⇄ Svelte)

All JSON is **camelCase**. Commands are `#[tauri::command]` async fns registered in `lib.rs`.
Errors returned by every fallible command are serialized as:

```json
{ "kind": "unauthorized" | "forbidden" | "rateLimited" | "notFound" | "network" | "parse" | "storage" | "other",
  "message": "human readable (Russian ok)", "retryAfter": 12 }
```
(`retryAfter` seconds, only for `rateLimited`.)

## Auth (keyring: Windows Credential Manager, service "arima", user "soundcloud-oauth")
- `auth_login(token: String) -> User(JSON Value)` — trims token (accepts `oauth_token` cookie value or `OAuth xxx`; strip `OAuth ` prefix), validates with `GET /me`, stores token, returns SC user JSON.
- `auth_restore() -> Option<Value>` — no stored token → `None`; valid → user; 401 → delete token and Err(unauthorized); network error → Err(network) (token kept).
- `auth_logout()` — delete token from keyring and memory.

## SoundCloud
- `sc_request(req: ScRequest) -> Value`
  `ScRequest { method: "GET"|"POST"|"PUT"|"DELETE", url: String, query?: Record<string,string>, body?: Value }`
  `url` is either a path (`/me/likes`) or an absolute URL whose host is exactly `api-v2.soundcloud.com` (used for `next_href` pagination); any other host → Err(other). Injects `client_id` query param (and `Authorization: OAuth <token>` header if logged in), JSON body for POST/PUT, browser User-Agent, `Origin/Referer: https://soundcloud.com`. Empty/204 body → `null`.
  Retry policy: 429 → honour `Retry-After` (cap 5 s), up to 2 retries, then Err(rateLimited{retryAfter}). 401/403 → refresh `client_id` once (30 s cooldown) and retry once; still 401 → Err(unauthorized); 403 → forbidden. 404 → notFound.
- `sc_resolve_stream(transcodingUrl: String, trackAuthorization: Option<String>) -> String` — GET the transcoding URL with client_id (+ `track_authorization`), reads `{url}`, returns the **proxied** URL `http://arima-stream.localhost/<base64url(no pad)(upstream url)>`.
- `sc_refresh_client_id() -> String`.
- client_id: scrape `https://soundcloud.com` → `<script src="https://a-v2.sndcdn.com/assets/*.js">`, scan last scripts first for `client_id:"<32 alnum>"` (also `client_id=`). Cache in app data (`client_id.txt`), fallback constant `PLACEHOLDER_CLIENT_ID` in `config.rs` with a doc comment instructing how to obtain one manually.

## Stream proxy (async URI scheme `arima-stream`; Windows URL = `http://arima-stream.localhost/<b64url>`)
- Decodes target URL (host must end with `sndcdn.com` or `soundcloud.com`, https only).
- Forwards `Range`. For open-ended ranges (`bytes=N-`) clamp upstream to 1 MiB chunks and answer 206 with correct `Content-Range` total so playback starts instantly. Pass through `Content-Type`, `Content-Range`, `Accept-Ranges`, `Content-Length`.
- HLS: if body is an m3u8 (content-type or `#EXTM3U`), rewrite every URI (non-`#` lines and `URI="..."` attributes) resolved against the manifest URL into proxy URLs.
- Always add `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Headers: *`, `Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges`. Handle OPTIONS.
- Disk cache (app cache dir `stream/`) for non-Range 200 responses that are not manifests: key = sha256(url). LRU trim by mtime to `cacheMaxMb` on startup and after writes (debounced).
- `cache_stats() -> { bytes: u64, files: u32 }`, `cache_clear()`.
- Shares the reqwest client (proxy setting applied).

## Lyrics
- `lyrics_fetch(q: { trackId: i64, title: String, artist: String, durationMs: i64 }) -> Option<Lyrics>`
  `Lyrics { source: String, synced: bool, lines: [{ t: i64 /*ms, -1 if unsynced*/, text: String }] }`
- Chain, in order, first hit wins (synced preferred only within a provider; do not skip to later provider just because earlier is unsynced **unless** a later provider returns synced? → rule: take the first provider that returns synced lyrics; if none synced, take the first plain result): LRCLIB (`/api/get` then `/api/search`) → NetEase (search + `/api/song/lyric`) → Musixmatch (desktop anonymous token, best effort) → Genius (search + page scrape of `data-lyrics-container`, plain) → lyrics.ovh (plain). 4 s timeout per provider, never panic, any failure = next provider.
- Query building: clean SC titles (strip `(Official ...)`, `[...]`, `feat./ft.`, "prod." suffixes); if title contains ` - ` also try (left=artist, right=title). Candidate queries are tried per provider.
- Cache in SQLite table `lyrics(track_id PK, json, fetched_at)`; negative results cached 24 h. Include a pure `lrc::parse(&str) -> Vec<Line>` with unit tests (multi-timestamp lines, `[offset:]`, `mm:ss.xx` and `mm:ss.xxx`).

## History + taste (SQLite in app data `arima.db`, rusqlite bundled)
- `history_log(entry: { track: Value, listenedMs: i64, durationMs: i64, completed: bool, skipped: bool })` — stores track JSON (table `tracks`) and a `plays` row. Ignore if `listenedMs < 5000`.
- `history_list(limit: u32, offset: u32) -> [{ track: Value, playedAt: i64 /*ms epoch*/ }]` newest first (dedupe by track id, keep latest).
- `history_clear()`.
- `taste_profile() -> { genres: Record<string,f64>, artists: Record<string,f64> /*user id as string*/, tags: Record<string,f64>, recentIds: i64[] /*last 300 played*/, skippedIds: i64[] /*skipped in last 14 days*/, totalPlays: i64 }`
  Weights: per play `w = listenedRatio` (0..1) , completed ×1.5, skipped within first 30 s → −1, exponential time decay (half-life 30 days); normalise so the max weight = 1. Pure fn in `taste.rs` with unit tests.

## Settings (`settings.json` in app config dir)
- `settings_get() -> Settings`, `settings_set(patch: Value) -> Settings` — deep merge, persist, apply side effects, emit event `settings-changed` (payload = full Settings) to all windows.
```
Settings {
  closeToTray: bool = true, autostart: bool = false, startMinimized: bool = false,
  proxy: String = "",            // http://h:p | socks5://h:p ; empty = none; changing rebuilds reqwest client
  cacheMaxMb: u32 = 512,
  discordEnabled: bool = true, discordAppId: String = "1108081579965808701",
  island: { mode: "always"|"transient"|"off" = "always",
            position: "top-center"|"top-left"|"top-right"|"bottom-center" = "top-center",
            offset: u32 = 12, hideInFullscreen: bool = true, toggleHotkey: String = "Ctrl+Alt+I" },
  ...extra                        // #[serde(flatten)] Map<String,Value>: UI-owned keys (audio, ui) are persisted untouched
}
```
- `autostart` toggles `tauri-plugin-autostart` (launch arg `--minimized`). If app started with `--minimized` (or `startMinimized`), main window stays hidden after `app_ready`.

## App / windows
- `app_ready()` — frontend calls once mounted; shows main window (unless minimized start).
- `app_quit()`.
- Main window: label `main`, created hidden from config. CloseRequested: if `closeToTray` → `prevent_close` + hide; else exit.
- Tray (icon = default window icon, tooltip "Arima"): menu Показать / Играть‑Пауза / Следующий / Предыдущий / Выход. Left click → show+focus main. Menu actions emit `media-key`.
- Single instance: second launch shows & focuses main.

## Media keys / SMTC / Discord
- `media_update(m: { title: String, artist: String, coverUrl?: String, durationMs: i64, positionMs: i64, playing: bool })` → SMTC metadata + playback (souvlaki, run on a dedicated thread owning `MediaControls`, communicate by channel; HWND of main window).
- `media_set_playback(playing: bool, positionMs: i64)`.
- Event `media-key` (to all windows) payload `{ action: "play"|"pause"|"toggle"|"next"|"prev"|"stop"|"seek", positionMs?: i64 }` from SMTC and tray. (Media keys are delivered via SMTC only; do NOT also register them as global shortcuts.)
- `discord_update(p: { title, artist, url, coverUrl?, durationMs, positionMs, playing })` — if `playing` set Listening activity: details=title, state=artist, timestamps start=now−position end=start+duration, large image = coverUrl, button "Слушать на SoundCloud" → url. If not playing → clear. No-op if disabled / no app id; reconnect lazily with back-off; thread + channel; never block or panic if Discord is closed. `discord_clear()`.

## Island (window label `island`, URL `/island`)
Config: `transparent:true, decorations:false, alwaysOnTop:true, skipTaskbar:true, resizable:false, shadow:false, focusable:false, visible:false`, fixed logical size **460×420**. Placed per `settings.island.position/offset` on the monitor under the cursor/primary, horizontally centered for `*-center`; re-placed on settings change, DPI/monitor change and every show.
The window is *click-through by default* (`set_ignore_cursor_events(true)`) so the transparent area never blocks other windows. A Rust poll thread (~16 ms while visible) reads `GetCursorPos`, and if the cursor is inside the interactive rect reported by the frontend (+4 px pad) it sets `ignore=false` and emits `island-hover {hover:true}` to the island window, else `ignore=true` and `{hover:false}` (emit only on change).
- `island_set_rect(r: { x: f64, y: f64, w: f64, h: f64 })` — CSS px relative to the island window's top-left.
- `island_set_playing(playing: bool, hasTrack: bool)` — from main window.
- `island_notify()` — transient reveal (track change) for `mode="transient"` (visible for 5 s, extended while hovered).
- `island_toggle_hidden()` — user override (also bound to the global hotkey `settings.island.toggleHotkey` via `tauri-plugin-global-shortcut`, re-registered on settings change). Emits `island-user-hidden {hidden}` to all windows.
- Visibility computed by a ticker (100 ms): visible = mode≠off ∧ hasTrack ∧ ¬userHidden ∧ (main window hidden ∨ minimized) ∧ ¬(hideInFullscreen ∧ fullscreenBusy) ∧ (mode=always ? playing : transientActive). `fullscreenBusy` = `SHQueryUserNotificationState` ∈ {BUSY, RUNNING_D3D_FULL_SCREEN, PRESENTATION_MODE} (crate `windows`). Show without activating (`ShowWindow(SW_SHOWNOACTIVATE)` or `show()` + never `set_focus`).
- `userHidden` resets to false when a new track starts (`island_notify`), so "hide" means "hide this track".
- JS-only events (no Rust involvement): `player-sync`, `player-cmd`, `island-ready`.

## Capabilities
`src-tauri/capabilities/default.json` for windows `["main","island"]`: `core:default`, `core:window:allow-minimize|toggle-maximize|maximize|unmaximize|close|hide|show|set-focus|unminimize|start-dragging|is-maximized|is-fullscreen|set-always-on-top|set-ignore-cursor-events|outer-position|outer-size|scale-factor`, `core:event:default`, `autostart:default`, `global-shortcut:default`.

## Config requirements (`tauri.conf.json`)
- productName "Arima", identifier `app.arima.desktop`, `frontendDist: "../build"`, `devUrl: "http://127.0.0.1:5173"`, `beforeDevCommand: "npm run dev"`, `beforeBuildCommand: "npm run build"`.
- main window: 1280×800, min 960×600, `decorations:false, transparent:false, backgroundColor:"#000000", center:true, visible:false`.
- CSP: `default-src 'self'; img-src 'self' data: blob: https://*.sndcdn.com; media-src 'self' blob: http://arima-stream.localhost https://arima-stream.localhost arima-stream:; connect-src 'self' ipc: http://ipc.localhost http://arima-stream.localhost https://arima-stream.localhost arima-stream:; style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self' blob:`.
- bundle targets `["nsis"]`, icon `icons/icon.ico` etc. (already generated in `src-tauri/icons`).
- `[profile.release]`: `opt-level="s"`, `lto=true`, `codegen-units=1`, `panic="abort"`, `strip=true`.

## Rust layout
`src-tauri/src/`: `main.rs`, `lib.rs` (builder, state, command registration), `config.rs`, `error.rs`, `settings.rs`, `auth.rs`, `sc/{mod,client,client_id}.rs`, `stream_proxy.rs`, `lyrics/{mod,lrc,lrclib,netease,musixmatch,genius,lyricsovh}.rs`, `db.rs`, `taste.rs`, `media.rs`, `discord.rs`, `island.rs`, `tray.rs`, `fullscreen.rs`.
