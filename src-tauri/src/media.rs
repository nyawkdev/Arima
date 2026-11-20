use std::sync::mpsc::{self, Sender};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use souvlaki::{
    MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig,
};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::config::MAIN_LABEL;
use crate::error::Result;
use crate::AppState;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaUpdate {
    pub title: String,
    pub artist: String,
    pub cover_url: Option<String>,
    pub duration_ms: i64,
    pub position_ms: i64,
    pub playing: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaKeyPayload {
    action: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    position_ms: Option<i64>,
}

enum Msg {
    Update(MediaUpdate),
    Playback { playing: bool, position_ms: i64 },
}

pub struct MediaHandle {
    tx: Sender<Msg>,
}

impl MediaHandle {

    pub fn start(app: AppHandle) -> Self {
        let (tx, rx) = mpsc::channel::<Msg>();
        std::thread::Builder::new()
            .name("arima-smtc".into())
            .spawn(move || run_worker(app, rx))
            .ok();
        Self { tx }
    }
}

#[cfg(target_os = "windows")]
fn main_hwnd(app: &AppHandle) -> Option<*mut std::ffi::c_void> {
    let win = app.get_webview_window(MAIN_LABEL)?;
    let hwnd = win.hwnd().ok()?;
    Some(hwnd.0)
}

#[cfg(not(target_os = "windows"))]
fn main_hwnd(_app: &AppHandle) -> Option<*mut std::ffi::c_void> {
    None
}

fn run_worker(app: AppHandle, rx: mpsc::Receiver<Msg>) {
    let hwnd = main_hwnd(&app);
    let config = PlatformConfig {
        dbus_name: "arima",
        display_name: "Arima",
        hwnd,
    };
    let Ok(mut controls) = MediaControls::new(config) else {
        while rx.recv().is_ok() {}
        return;
    };

    let app_ev = app.clone();
    let _ = controls.attach(move |ev: MediaControlEvent| {
        let payload = match ev {
            MediaControlEvent::Play => MediaKeyPayload {
                action: "play",
                position_ms: None,
            },
            MediaControlEvent::Pause => MediaKeyPayload {
                action: "pause",
                position_ms: None,
            },
            MediaControlEvent::Toggle => MediaKeyPayload {
                action: "toggle",
                position_ms: None,
            },
            MediaControlEvent::Next => MediaKeyPayload {
                action: "next",
                position_ms: None,
            },
            MediaControlEvent::Previous => MediaKeyPayload {
                action: "prev",
                position_ms: None,
            },
            MediaControlEvent::Stop => MediaKeyPayload {
                action: "stop",
                position_ms: None,
            },
            MediaControlEvent::SetPosition(pos) => MediaKeyPayload {
                action: "seek",
                position_ms: Some(pos.0.as_millis() as i64),
            },
            _ => return,
        };
        let _ = app_ev.emit("media-key", payload);
    });

    while let Ok(msg) = rx.recv() {
        match msg {
            Msg::Update(m) => {
                let dur = if m.duration_ms > 0 {
                    Some(Duration::from_millis(m.duration_ms as u64))
                } else {
                    None
                };
                let _ = controls.set_metadata(MediaMetadata {
                    title: Some(&m.title),
                    artist: Some(&m.artist),
                    album: Some("Arima"),
                    cover_url: m.cover_url.as_deref(),
                    duration: dur,
                    ..Default::default()
                });
                let pb = playback_state(m.playing, m.position_ms);
                let _ = controls.set_playback(pb);
            }
            Msg::Playback {
                playing,
                position_ms,
            } => {
                let pb = playback_state(playing, position_ms);
                let _ = controls.set_playback(pb);
            }
        }
    }
}

fn playback_state(playing: bool, position_ms: i64) -> MediaPlayback {
    let progress = Some(MediaPosition(Duration::from_millis(
        position_ms.max(0) as u64
    )));
    if playing {
        MediaPlayback::Playing { progress }
    } else {
        MediaPlayback::Paused { progress }
    }
}

async fn cache_cover_locally(http: &reqwest::Client, url: &str) -> Option<String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Some(url.to_owned());
    }
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in url.as_bytes() {
        hash ^= u64::from(*b);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    let path = std::env::temp_dir().join(format!("arima_smtc_{hash:016x}.jpg"));
    if !path.exists() {
        let resp = http.get(url).timeout(Duration::from_secs(6)).send().await.ok()?;
        if !resp.status().is_success() {
            return None;
        }
        let bytes = resp.bytes().await.ok()?;
        if bytes.is_empty() {
            return None;
        }
        let _ = tokio::fs::write(&path, &bytes).await;
    }
    url::Url::from_file_path(&path).ok().map(|u| u.to_string())
}

#[tauri::command]
pub async fn media_update(state: State<'_, AppState>, mut m: MediaUpdate) -> Result<()> {
    if let Some(ref cover) = m.cover_url {
        let http = state.http.get();
        if let Some(local_uri) = cache_cover_locally(&http, cover).await {
            m.cover_url = Some(local_uri);
        }
    }
    let _ = state.media.tx.send(Msg::Update(m));
    Ok(())
}

#[tauri::command]
pub async fn media_set_playback(
    state: State<'_, AppState>,
    playing: bool,
    position_ms: i64,
) -> Result<()> {
    let _ = state.media.tx.send(Msg::Playback {
        playing,
        position_ms,
    });
    Ok(())
}
