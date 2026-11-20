use reqwest::Client;
use serde_json::Value;

use super::lrc;
use super::{Lyrics, LyricsQuery};

const MXM_BASE: &str = "https://apic-desktop.musixmatch.com/ws/1.1";

async fn get_token(http: &Client) -> Option<String> {
    let resp = http
        .get(format!("{MXM_BASE}/token.get"))
        .query(&[("app_id", "web-desktop-app-v1.0")])
        .send()
        .await
        .ok()?;
    let v: Value = resp.json().await.ok()?;
    v.pointer("/message/body/user_token")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

pub async fn fetch(http: &Client, q: &LyricsQuery) -> Option<Lyrics> {
    let token = get_token(http).await?;
    let resp = http
        .get(format!("{MXM_BASE}/macro.subtitles.get"))
        .query(&[
            ("app_id", "web-desktop-app-v1.0"),
            ("usertoken", token.as_str()),
            ("q_track", q.title.as_str()),
            ("q_artist", q.artist.as_str()),
            ("subtitle_format", "lrc"),
            ("namespace", "lyrics_richsynched"),
        ])
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let v: Value = resp.json().await.ok()?;
    let sub = v
        .pointer("/message/body/macro_calls/track.subtitles.get/message/body/subtitle_list/0/subtitle/subtitle_body")
        .and_then(Value::as_str);
    if let Some(s) = sub {
        let lines = lrc::parse(s);
        if !lines.is_empty() {
            return Some(Lyrics {
                source: "Musixmatch".to_owned(),
                synced: true,
                lines,
                orig_duration_ms: None,
                adapted: None,
            });
        }
    }
    let plain = v
        .pointer("/message/body/macro_calls/track.lyrics.get/message/body/lyrics/lyrics_body")
        .and_then(Value::as_str)?;
    let lines = lrc::plain_lines(plain);
    if lines.is_empty() {
        None
    } else {
        Some(Lyrics {
            source: "Musixmatch".to_owned(),
            synced: false,
            lines,
            orig_duration_ms: None,
            adapted: None,
        })
    }
}
