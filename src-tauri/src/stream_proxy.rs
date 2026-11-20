use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use regex::Regex;
use reqwest::header::{ACCEPT_RANGES, CONTENT_RANGE, CONTENT_TYPE, ORIGIN, RANGE, REFERER};
use reqwest::StatusCode;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::http::{header, Request, Response, StatusCode as HttpStatus};
use tauri::{AppHandle, Manager, State, UriSchemeResponder};
use url::Url;

use crate::config::{
    MAX_FULL_BODY, MAX_MANIFEST_BYTES, RANGE_CHUNK, STREAM_ORIGIN, USER_AGENT, WEB_ORIGIN,
};
use crate::error::Result;
use crate::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStats {
    pub bytes: u64,
    pub files: u32,
}

pub struct StreamCache {
    dir: PathBuf,
    trim_lock: Mutex<()>,
    trim_pending: AtomicBool,
}

impl StreamCache {

    pub fn new(dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&dir);
        Self {
            dir,
            trim_lock: Mutex::new(()),
            trim_pending: AtomicBool::new(false),
        }
    }

    fn entry_path(&self, url: &str) -> PathBuf {
        let mut hasher = Sha256::new();
        hasher.update(url.as_bytes());
        let hex = format!("{:x}", hasher.finalize());
        self.dir.join(hex)
    }

    pub fn stats(&self) -> Result<CacheStats> {
        let mut bytes = 0_u64;
        let mut files = 0_u32;
        let Ok(rd) = std::fs::read_dir(&self.dir) else {
            return Ok(CacheStats { bytes: 0, files: 0 });
        };
        for entry in rd.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    bytes = bytes.saturating_add(meta.len());
                    files = files.saturating_add(1);
                }
            }
        }
        Ok(CacheStats { bytes, files })
    }

    pub fn clear(&self) -> Result<()> {
        let _guard = self.trim_lock.lock().unwrap_or_else(|p| p.into_inner());
        if let Ok(rd) = std::fs::read_dir(&self.dir) {
            for entry in rd.flatten() {
                let _ = std::fs::remove_file(entry.path());
            }
        }
        Ok(())
    }

    pub fn schedule_trim(&self, app: &AppHandle) {
        if self.trim_pending.swap(true, Ordering::AcqRel) {
            return;
        }
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_secs(2)).await;
            let state = app.state::<AppState>();
            state.cache.trim_pending.store(false, Ordering::Release);
            let max_bytes = u64::from(state.settings.get().cache_max_mb) * 1024 * 1024;
            let _ = tokio::task::spawn_blocking(move || {
                let state = app.state::<AppState>();
                state.cache.trim_to(max_bytes);
            })
            .await;
        });
    }

    pub fn trim_to(&self, max_bytes: u64) {
        let _guard = self.trim_lock.lock().unwrap_or_else(|p| p.into_inner());
        let Ok(rd) = std::fs::read_dir(&self.dir) else {
            return;
        };
        let mut entries: Vec<(PathBuf, u64, SystemTime)> = Vec::new();
        let mut total = 0_u64;
        for entry in rd.flatten() {
            let path = entry.path();
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            if !meta.is_file() {
                continue;
            }
            let len = meta.len();
            let mtime = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
            total = total.saturating_add(len);
            entries.push((path, len, mtime));
        }
        if total <= max_bytes {
            return;
        }
        entries.sort_by_key(|e| e.2);
        for (path, len, _) in entries {
            if total <= max_bytes {
                break;
            }
            if std::fs::remove_file(&path).is_ok() {
                total = total.saturating_sub(len);
            }
        }
    }

    fn write_entry(&self, url: &str, bytes: &[u8]) {
        let _ = std::fs::create_dir_all(&self.dir);
        let dst = self.entry_path(url);
        let tmp = dst.with_extension("tmp");
        if std::fs::write(&tmp, bytes).is_ok() {
            let _ = std::fs::rename(&tmp, &dst);
        }
    }

    fn read_entry(&self, url: &str) -> Option<Vec<u8>> {
        let path = self.entry_path(url);
        std::fs::read(&path).ok()
    }
}

pub fn encode_proxy_url(upstream: &str) -> String {
    let encoded = URL_SAFE_NO_PAD.encode(upstream.as_bytes());
    format!("{STREAM_ORIGIN}/{encoded}")
}

pub fn decode_proxy_url(path: &str) -> Option<Url> {
    let seg = path.trim_start_matches('/').split('/').next()?.trim();
    if seg.is_empty() {
        return None;
    }
    let raw = URL_SAFE_NO_PAD.decode(seg.as_bytes()).ok()?;
    let s = String::from_utf8(raw).ok()?;
    let url = Url::parse(&s).ok()?;
    if url.scheme() != "https" {
        return None;
    }
    let host = url.host_str()?.to_ascii_lowercase();
    if host == "sndcdn.com"
        || host.ends_with(".sndcdn.com")
        || host == "soundcloud.com"
        || host.ends_with(".soundcloud.com")
        || host == "soundcloud.cloud"
        || host.ends_with(".soundcloud.cloud")
    {
        Some(url)
    } else {
        None
    }
}

fn clamp_range(raw: &str) -> String {
    let trimmed = raw.trim();
    if let Some(rest) = trimmed.strip_prefix("bytes=") {
        if let Some(start_str) = rest.strip_suffix('-') {
            if let Ok(start) = start_str.trim().parse::<u64>() {
                let end = start.saturating_add(RANGE_CHUNK - 1);
                return format!("bytes={start}-{end}");
            }
        }
    }
    trimmed.to_owned()
}

fn is_manifest(url: &Url, content_type: Option<&str>, body: &[u8]) -> bool {
    if url.path().ends_with(".m3u8") {
        return true;
    }
    if let Some(ct) = content_type {
        let lc = ct.to_ascii_lowercase();
        if lc.contains("mpegurl") || lc.contains("m3u8") {
            return true;
        }
    }
    body.starts_with(b"#EXTM3U")
}

pub fn rewrite_m3u8(manifest: &str, base: &Url) -> String {
    let uri_attr = Regex::new(r#"URI="([^"]+)""#).expect("valid regex");
    let mut out = String::with_capacity(manifest.len() * 2);
    for line in manifest.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            out.push('\n');
            continue;
        }
        if trimmed.starts_with('#') {
            let rewritten = uri_attr.replace_all(line, |caps: &regex::Captures<'_>| {
                let raw = &caps[1];
                match base.join(raw) {
                    Ok(abs) => format!("URI=\"{}\"", encode_proxy_url(abs.as_str())),
                    Err(_) => caps[0].to_owned(),
                }
            });
            out.push_str(&rewritten);
            out.push('\n');
        } else {
            match base.join(trimmed) {
                Ok(abs) => out.push_str(&encode_proxy_url(abs.as_str())),
                Err(_) => out.push_str(trimmed),
            }
            out.push('\n');
        }
    }
    out
}

fn cors_response(status: HttpStatus) -> tauri::http::response::Builder {
    Response::builder()
        .status(status)
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        .header("Access-Control-Allow-Headers", "*")
        .header(
            "Access-Control-Expose-Headers",
            "Content-Range, Content-Length, Accept-Ranges, Content-Type",
        )
}

fn error_response(status: HttpStatus, msg: &str) -> Response<Vec<u8>> {
    cors_response(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(msg.as_bytes().to_vec())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

pub fn handle_protocol(
    app: AppHandle,
    req: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    if req.method() == "OPTIONS" {
        let resp = cors_response(HttpStatus::NO_CONTENT)
            .body(Vec::new())
            .unwrap_or_else(|_| Response::new(Vec::new()));
        responder.respond(resp);
        return;
    }

    tauri::async_runtime::spawn(async move {
        let resp = serve(app, req).await;
        responder.respond(resp);
    });
}

async fn serve(app: AppHandle, req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let Some(upstream) = decode_proxy_url(req.uri().path()) else {
        return error_response(HttpStatus::BAD_REQUEST, "Invalid stream target");
    };

    let range_header = req
        .headers()
        .get("range")
        .and_then(|v| v.to_str().ok())
        .map(clamp_range);

    let state = app.state::<AppState>();

    if range_header.is_none() && req.method() == "GET" {
        if let Some(cached) = state.cache.read_entry(upstream.as_str()) {
            return cors_response(HttpStatus::OK)
                .header(header::CONTENT_TYPE, guess_mime(&upstream))
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::CONTENT_LENGTH, cached.len().to_string())
                .body(cached)
                .unwrap_or_else(|_| Response::new(Vec::new()));
        }
    }

    let http = state.http.get();
    let mut builder = http
        .get(upstream.clone())
        .header(reqwest::header::USER_AGENT, USER_AGENT)
        .header(ORIGIN, WEB_ORIGIN)
        .header(REFERER, format!("{WEB_ORIGIN}/"));

    if let Some(ref rng) = range_header {
        builder = builder.header(RANGE, rng.as_str());
    }

    let res = match builder.send().await {
        Ok(r) => r,
        Err(e) => return error_response(HttpStatus::BAD_GATEWAY, &e.to_string()),
    };

    let status = res.status();
    if !status.is_success() && status != StatusCode::PARTIAL_CONTENT {
        let code = HttpStatus::from_u16(status.as_u16()).unwrap_or(HttpStatus::BAD_GATEWAY);
        return error_response(code, status.canonical_reason().unwrap_or("Upstream error"));
    }

    let ct = res
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let content_range = res
        .headers()
        .get(CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let accept_ranges = res
        .headers()
        .get(ACCEPT_RANGES)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let content_length = res.content_length();

    if content_length.is_some_and(|l| l > MAX_FULL_BODY) {
        return error_response(HttpStatus::PAYLOAD_TOO_LARGE, "Segment too large");
    }

    let body = match res.bytes().await {
        Ok(b) => b.to_vec(),
        Err(e) => return error_response(HttpStatus::BAD_GATEWAY, &e.to_string()),
    };

    if is_manifest(&upstream, ct.as_deref(), &body) && body.len() <= MAX_MANIFEST_BYTES {
        let text = String::from_utf8_lossy(&body);
        let rewritten = rewrite_m3u8(&text, &upstream).into_bytes();
        return cors_response(HttpStatus::OK)
            .header(
                header::CONTENT_TYPE,
                ct.as_deref().unwrap_or("application/vnd.apple.mpegurl"),
            )
            .header(header::CONTENT_LENGTH, rewritten.len().to_string())
            .body(rewritten)
            .unwrap_or_else(|_| Response::new(Vec::new()));
    }

    if status == StatusCode::OK && range_header.is_none() && (body.len() as u64) <= MAX_FULL_BODY {
        state.cache.write_entry(upstream.as_str(), &body);
        state.cache.schedule_trim(&app);
    }

    let out_status = HttpStatus::from_u16(status.as_u16()).unwrap_or(HttpStatus::OK);
    let mut out = cors_response(out_status)
        .header(
            header::CONTENT_TYPE,
            ct.as_deref().unwrap_or_else(|| guess_mime(&upstream)),
        )
        .header(header::CONTENT_LENGTH, body.len().to_string());

    if let Some(cr) = content_range {
        out = out.header(header::CONTENT_RANGE, cr);
    }
    if let Some(ar) = accept_ranges {
        out = out.header(header::ACCEPT_RANGES, ar);
    } else {
        out = out.header(header::ACCEPT_RANGES, "bytes");
    }

    out.body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn guess_mime(url: &Url) -> &'static str {
    let p = Path::new(url.path())
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match p.as_str() {
        "mp3" => "audio/mpeg",
        "m4a" | "mp4" => "audio/mp4",
        "aac" => "audio/aac",
        "ogg" | "opus" => "audio/ogg",
        "ts" => "video/mp2t",
        "m3u8" => "application/vnd.apple.mpegurl",
        _ => "application/octet-stream",
    }
}

#[tauri::command]
pub async fn cache_stats(state: State<'_, AppState>) -> Result<CacheStats> {
    state.cache.stats()
}

#[tauri::command]
pub async fn cache_clear(state: State<'_, AppState>) -> Result<()> {
    state.cache.clear()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proxy_url_roundtrip_and_host_whitelist() {
        let orig = "https://cf-hls-media.sndcdn.com/media/12345/playlist.m3u8?Policy=abc";
        let proxied = encode_proxy_url(orig);
        let path = proxied.strip_prefix(STREAM_ORIGIN).unwrap();
        assert_eq!(decode_proxy_url(path).unwrap().as_str(), orig);

        let evil = encode_proxy_url("https://evil.example.com/track.mp3");
        let evil_path = evil.strip_prefix(STREAM_ORIGIN).unwrap();
        assert!(decode_proxy_url(evil_path).is_none());

        let insecure = encode_proxy_url("http://cf-media.sndcdn.com/track.mp3");
        let insecure_path = insecure.strip_prefix(STREAM_ORIGIN).unwrap();
        assert!(decode_proxy_url(insecure_path).is_none());
    }

    #[test]
    fn rewrites_hls_segments_and_key_uri() {
        let base = Url::parse("https://cf-hls-media.sndcdn.com/playlist/abc/index.m3u8").unwrap();
        let raw = "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"\n#EXTINF:5.0,\nseg0.ts\nhttps://cf-hls-media.sndcdn.com/seg1.ts\n";
        let rewritten = rewrite_m3u8(raw, &base);
        assert!(!rewritten.contains("seg0.ts"));
        assert!(!rewritten.contains("key.bin"));
        assert!(rewritten.contains(STREAM_ORIGIN));
        let lines: Vec<&str> = rewritten.lines().collect();
        let seg0_path = lines[3].strip_prefix(STREAM_ORIGIN).unwrap();
        assert_eq!(
            decode_proxy_url(seg0_path).unwrap().as_str(),
            "https://cf-hls-media.sndcdn.com/playlist/abc/seg0.ts"
        );
    }

    #[test]
    fn clamps_open_ended_range() {
        assert_eq!(clamp_range("bytes=0-"), format!("bytes=0-{}", RANGE_CHUNK - 1));
        assert_eq!(clamp_range("bytes=100-500"), "bytes=100-500");
    }
}
