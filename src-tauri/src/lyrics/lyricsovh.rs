use reqwest::Client;
use serde::Deserialize;

use super::lrc;
use super::{Lyrics, LyricsQuery};

#[derive(Deserialize)]
struct Resp {
    lyrics: Option<String>,
}

pub async fn fetch(http: &Client, q: &LyricsQuery) -> Option<Lyrics> {
    if q.artist.is_empty() || q.title.is_empty() {
        return None;
    }
    let url = format!(
        "https://api.lyrics.ovh/v1/{}/{}",
        urlencoding::encode(&q.artist),
        urlencoding::encode(&q.title)
    );
    let resp = http.get(url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let body: Resp = resp.json().await.ok()?;
    let raw = body.lyrics?;
    let lines = lrc::plain_lines(&raw);
    if lines.is_empty() {
        None
    } else {
        Some(Lyrics {
            source: "lyrics.ovh".to_owned(),
            synced: false,
            lines,
            orig_duration_ms: None,
            adapted: None,
        })
    }
}
