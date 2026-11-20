use std::sync::mpsc::{self, Sender};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use discord_rich_presence::activity::{Activity, ActivityType, Assets, Button, Timestamps};
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use serde::Deserialize;
use tauri::State;

use crate::error::Result;
use crate::AppState;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscordPayload {
    pub title: String,
    pub artist: String,
    pub url: String,
    pub cover_url: Option<String>,
    pub duration_ms: i64,
    pub position_ms: i64,
    pub playing: bool,
}

enum Msg {
    Configure { enabled: bool, app_id: String },
    Update(DiscordPayload),
    Clear,
}

pub struct DiscordHandle {
    tx: Sender<Msg>,
}

impl DiscordHandle {

    pub fn start(enabled: bool, app_id: String) -> Self {
        let (tx, rx) = mpsc::channel::<Msg>();
        std::thread::Builder::new()
            .name("arima-discord".into())
            .spawn(move || run_worker(rx, enabled, app_id))
            .ok();
        Self { tx }
    }

    pub fn configure(&self, enabled: bool, app_id: &str) {
        let _ = self.tx.send(Msg::Configure {
            enabled,
            app_id: app_id.trim().to_owned(),
        });
    }
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn run_worker(rx: mpsc::Receiver<Msg>, mut enabled: bool, mut app_id: String) {
    let mut client: Option<DiscordIpcClient> = None;
    let mut next_connect = Instant::now();
    let mut backoff = Duration::from_secs(5);

    while let Ok(msg) = rx.recv() {
        match msg {
            Msg::Configure {
                enabled: en,
                app_id: id,
            } => {
                let id_changed = id != app_id;
                enabled = en;
                app_id = id;
                if !enabled || id_changed || app_id.is_empty() {
                    if let Some(mut c) = client.take() {
                        let _ = c.clear_activity();
                        let _ = c.close();
                    }
                    next_connect = Instant::now();
                    backoff = Duration::from_secs(5);
                }
            }
            Msg::Clear => {
                if let Some(ref mut c) = client {
                    if c.clear_activity().is_err() {
                        client = None;
                    }
                }
            }
            Msg::Update(p) => {
                if !enabled || app_id.is_empty() {
                    continue;
                }
                if !p.playing {
                    if let Some(ref mut c) = client {
                        if c.clear_activity().is_err() {
                            client = None;
                        }
                    }
                    continue;
                }
                if client.is_none() {
                    if Instant::now() < next_connect {
                        continue;
                    }
                    let mut c = DiscordIpcClient::new(&app_id);
                    if c.connect().is_ok() {
                        backoff = Duration::from_secs(5);
                        client = Some(c);
                    } else {
                        next_connect = Instant::now() + backoff;
                        backoff = (backoff * 2).min(Duration::from_secs(120));
                        continue;
                    }
                }

                if let Some(ref mut c) = client {
                    let pos_s = (p.position_ms / 1000).max(0);
                    let dur_s = (p.duration_ms / 1000).max(0);
                    let start = now_secs() - pos_s;
                    let end = start + dur_s;

                    let details = if p.title.is_empty() {
                        "Arima"
                    } else {
                        p.title.as_str()
                    };
                    let state_str = if p.artist.is_empty() {
                        "SoundCloud"
                    } else {
                        p.artist.as_str()
                    };

                    let mut act = Activity::new()
                        .activity_type(ActivityType::Listening)
                        .details(details)
                        .state(state_str);

                    if dur_s > 0 {
                        act = act.timestamps(Timestamps::new().start(start).end(end));
                    }
                    if let Some(ref cover) = p.cover_url {
                        if !cover.is_empty() {
                            act = act.assets(Assets::new().large_image(cover));
                        }
                    }
                    if !p.url.is_empty() {
                        act = act.buttons(vec![Button::new("Открыть в Arima / SoundCloud", &p.url)]);
                    }

                    if c.set_activity(act).is_err() {
                        let _ = c.close();
                        client = None;
                        next_connect = Instant::now() + backoff;
                    }
                }
            }
        }
    }

    if let Some(mut c) = client {
        let _ = c.clear_activity();
        let _ = c.close();
    }
}

#[tauri::command]
pub async fn discord_update(state: State<'_, AppState>, p: DiscordPayload) -> Result<()> {
    let _ = state.discord.tx.send(Msg::Update(p));
    Ok(())
}

#[tauri::command]
pub async fn discord_clear(state: State<'_, AppState>) -> Result<()> {
    let _ = state.discord.tx.send(Msg::Clear);
    Ok(())
}
