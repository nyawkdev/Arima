use std::collections::HashSet;

use reqwest::Client;
use serde::Deserialize;

use super::lrc;
use super::{Lyrics, LyricsQuery};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LrcLibItem {
    track_name: Option<String>,
    artist_name: Option<String>,
    duration: Option<f64>,
    synced_lyrics: Option<String>,
    plain_lyrics: Option<String>,
}

fn norm_words(s: &str) -> Vec<String> {
    s.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() || c.is_whitespace() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .map(str::to_owned)
        .collect()
}

fn title_similarity(query_title: &str, item_title: &str) -> f64 {
    let qw: HashSet<String> = norm_words(query_title).into_iter().collect();
    let iw: HashSet<String> = norm_words(item_title).into_iter().collect();
    if qw.is_empty() || iw.is_empty() {
        return 0.0;
    }
    let q_joined = norm_words(query_title).join(" ");
    let i_joined = norm_words(item_title).join(" ");
    if q_joined == i_joined {
        return 1.0;
    }
    let overlap = qw.intersection(&iw).count() as f64;
    let recall = overlap / qw.len() as f64;
    let precision = overlap / iw.len() as f64;
    0.7 * recall + 0.3 * precision
}

fn artist_matches(query_artist: &str, item_artist: &str) -> bool {
    if query_artist.trim().is_empty() || item_artist.trim().is_empty() {
        return false;
    }
    let qa = norm_words(query_artist).join(" ");
    let ia = norm_words(item_artist).join(" ");
    if qa.is_empty() || ia.is_empty() {
        return false;
    }
    qa.contains(&ia) || ia.contains(&qa)
}

fn to_lyrics(item: LrcLibItem) -> Option<Lyrics> {
    let orig_ms = item.duration.map(|d| (d * 1000.0).round() as i64);
    if let Some(synced) = item.synced_lyrics.as_deref() {
        let lines = lrc::parse(synced);
        if !lines.is_empty() {
            return Some(Lyrics {
                source: "LRCLIB".to_owned(),
                synced: true,
                lines,
                orig_duration_ms: orig_ms,
                adapted: None,
            });
        }
    }
    if let Some(plain) = item.plain_lyrics.as_deref() {
        let lines = lrc::plain_lines(plain);
        if !lines.is_empty() {
            return Some(Lyrics {
                source: "LRCLIB".to_owned(),
                synced: false,
                lines,
                orig_duration_ms: orig_ms,
                adapted: None,
            });
        }
    }
    None
}

pub async fn fetch(http: &Client, q: &LyricsQuery) -> Option<Lyrics> {
    let duration_sec = (q.duration_ms / 1000).max(1);
    let tol_sec = (duration_sec as f64 * 0.14).max(12.0);

    if !q.artist.is_empty() {
        if let Ok(resp) = http
            .get("https://lrclib.net/api/get")
            .query(&[
                ("track_name", q.title.as_str()),
                ("artist_name", q.artist.as_str()),
                ("duration", &duration_sec.to_string()),
            ])
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(item) = resp.json::<LrcLibItem>().await {
                    if let Some(res) = to_lyrics(item) {
                        return Some(res);
                    }
                }
            }
        }
    }

    let query_str = if q.artist.is_empty() {
        q.title.clone()
    } else {
        format!("{} {}", q.artist, q.title)
    };
    let resp = http
        .get("https://lrclib.net/api/search")
        .query(&[("q", query_str.as_str())])
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let items: Vec<LrcLibItem> = resp.json().await.ok()?;

    let mut scored: Vec<(f64, LrcLibItem)> = Vec::new();
    for it in items {
        if it.synced_lyrics.is_none() && it.plain_lyrics.is_none() {
            continue;
        }
        let it_title = it.track_name.as_deref().unwrap_or("");
        let it_artist = it.artist_name.as_deref().unwrap_or("");
        let t_sim = title_similarity(&q.title, it_title);
        let a_hit = artist_matches(&q.artist, it_artist);

        if t_sim < 0.55 && !a_hit {
            continue;
        }
        if !q.artist.is_empty() && !a_hit && t_sim < 0.85 {
            continue;
        }

        let mut score = t_sim * 30.0 + if it.synced_lyrics.is_some() { 20.0 } else { 0.0 };
        if a_hit {
            score += 22.0;
        }
        if q.duration_ms > 0 {
            if let Some(d) = it.duration.filter(|&d| d > 0.0) {
                let diff = (d - duration_sec as f64).abs();
                if diff <= tol_sec {
                    score += 14.0 - (diff / tol_sec) * 6.0;
                } else if diff > 55.0 {
                    score -= 18.0;
                }
            }
        }
        if score >= 24.0 {
            scored.push((score, it));
        }
    }

    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    scored.into_iter().find_map(|(_, it)| to_lyrics(it))
}
