use reqwest::Client;
use serde::Deserialize;

use super::lrc;
use super::{Lyrics, LyricsQuery};

#[derive(Deserialize)]
struct SearchResp {
    result: Option<SearchResult>,
}

#[derive(Deserialize)]
struct SearchResult {
    songs: Option<Vec<Song>>,
}

#[derive(Deserialize)]
struct Song {
    id: i64,
}

#[derive(Deserialize)]
struct LyricResp {
    lrc: Option<LrcBody>,
}

#[derive(Deserialize)]
struct LrcBody {
    lyric: Option<String>,
}

pub async fn fetch(http: &Client, q: &LyricsQuery) -> Option<Lyrics> {
    let term = if q.artist.is_empty() {
        q.title.clone()
    } else {
        format!("{} {}", q.artist, q.title)
    };
    let resp = http
        .post("https://music.163.com/api/search/get/web")
        .header("Referer", "https://music.163.com/")
        .form(&[("s", term.as_str()), ("type", "1"), ("limit", "3")])
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let search: SearchResp = resp.json().await.ok()?;
    let songs = search.result?.songs?;
    for song in songs.into_iter().take(3) {
        let lyr = http
            .get("https://music.163.com/api/song/lyric")
            .header("Referer", "https://music.163.com/")
            .query(&[
                ("id", song.id.to_string()),
                ("lv", "-1".to_owned()),
                ("tv", "-1".to_owned()),
            ])
            .send()
            .await
            .ok()?;
        if !lyr.status().is_success() {
            continue;
        }
        let body: LyricResp = lyr.json().await.ok()?;
        let Some(raw) = body.lrc.and_then(|l| l.lyric) else {
            continue;
        };
        let parsed = lrc::parse(&raw);
        if !parsed.is_empty() {
            return Some(Lyrics {
                source: "NetEase".to_owned(),
                synced: true,
                lines: parsed,
                orig_duration_ms: None,
                adapted: None,
            });
        }
        let plain = lrc::plain_lines(&raw);
        if !plain.is_empty() {
            return Some(Lyrics {
                source: "NetEase".to_owned(),
                synced: false,
                lines: plain,
                orig_duration_ms: None,
                adapted: None,
            });
        }
    }
    None
}
