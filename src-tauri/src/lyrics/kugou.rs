use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use reqwest::Client;
use serde::Deserialize;

use super::lrc;
use super::{Lyrics, LyricsQuery};

#[derive(Deserialize)]
struct SearchResp {
    data: Option<SearchData>,
}

#[derive(Deserialize)]
struct SearchData {
    info: Option<Vec<SongInfo>>,
}

#[derive(Deserialize)]
struct SongInfo {
    hash: Option<String>,
    duration: Option<i64>,
}

#[derive(Deserialize)]
struct CandResp {
    candidates: Option<Vec<CandItem>>,
}

#[derive(Deserialize)]
struct CandItem {
    id: i64,
    accesskey: String,
    duration: Option<i64>,
}

#[derive(Deserialize)]
struct DlResp {
    content: Option<String>,
}

pub async fn fetch(http: &Client, q: &LyricsQuery) -> Option<Lyrics> {
    let keyword = if q.artist.is_empty() {
        q.title.clone()
    } else {
        format!("{} - {}", q.artist, q.title)
    };
    let s_resp = http
        .get("http://mobilecdn.kugou.com/api/v3/search/song")
        .query(&[
            ("format", "json"),
            ("keyword", keyword.as_str()),
            ("page", "1"),
            ("pagesize", "5"),
        ])
        .send()
        .await
        .ok()?;
    if !s_resp.status().is_success() {
        return None;
    }
    let search: SearchResp = s_resp.json().await.ok()?;
    let infos = search.data?.info?;

    let tol_sec = ((q.duration_ms / 1000) as f64 * 0.1).max(10.0) as i64;
    let best = infos
        .into_iter()
        .filter(|i| i.hash.as_ref().is_some_and(|h| !h.is_empty()))
        .filter(|i| {
            q.duration_ms <= 0
                || i.duration
                    .map_or(true, |d| d <= 0 || (d - q.duration_ms / 1000).abs() <= tol_sec)
        })
        .min_by_key(|i| {
            i.duration
                .map(|d| (d - q.duration_ms / 1000).abs())
                .unwrap_or(999)
        })?;

    let hash = best.hash?;
    let cand_resp = http
        .get("https://krcs.kugou.com/search")
        .query(&[
            ("ver", "1"),
            ("man", "yes"),
            ("client", "mobi"),
            ("keyword", keyword.as_str()),
            ("duration", &q.duration_ms.max(0).to_string()),
            ("hash", hash.as_str()),
        ])
        .send()
        .await
        .ok()?;
    if !cand_resp.status().is_success() {
        return None;
    }
    let cands: CandResp = cand_resp.json().await.ok()?;
    let cand = cands
        .candidates?
        .into_iter()
        .filter(|c| {
            q.duration_ms <= 0
                || c.duration
                    .map_or(true, |d| d <= 0 || (d - q.duration_ms).abs() <= tol_sec * 1000)
        })
        .min_by_key(|c| {
            c.duration
                .map(|d| (d - q.duration_ms).abs())
                .unwrap_or(999_999)
        })?;

    let dl = http
        .get("https://lyrics.kugou.com/download")
        .query(&[
            ("ver", "1"),
            ("client", "pc"),
            ("id", &cand.id.to_string()),
            ("accesskey", cand.accesskey.as_str()),
            ("fmt", "lrc"),
            ("charset", "utf8"),
        ])
        .send()
        .await
        .ok()?;
    if !dl.status().is_success() {
        return None;
    }
    let body: DlResp = dl.json().await.ok()?;
    let raw_bytes = STANDARD.decode(body.content?.as_bytes()).ok()?;
    let raw_str = String::from_utf8(raw_bytes).ok()?;
    let lines = lrc::parse(&raw_str);
    if lines.is_empty() {
        None
    } else {
        Some(Lyrics {
            source: "KuGou".to_owned(),
            synced: true,
            lines,
            orig_duration_ms: cand.duration,
            adapted: None,
        })
    }
}
