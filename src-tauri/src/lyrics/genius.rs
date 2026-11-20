use regex::Regex;
use reqwest::Client;
use serde_json::Value;

use super::lrc;
use super::{Lyrics, LyricsQuery};

pub async fn fetch(http: &Client, q: &LyricsQuery) -> Option<Lyrics> {
    let term = if q.artist.is_empty() {
        q.title.clone()
    } else {
        format!("{} {}", q.artist, q.title)
    };
    let search_resp = http
        .get("https://genius.com/api/search/multi")
        .query(&[("q", term.as_str())])
        .send()
        .await
        .ok()?;
    if !search_resp.status().is_success() {
        return None;
    }
    let json: Value = search_resp.json().await.ok()?;
    let sections = json.pointer("/response/sections")?.as_array()?;
    let song_url = sections
        .iter()
        .filter(|s| s.get("type").and_then(Value::as_str) == Some("song"))
        .flat_map(|s| s.get("hits").and_then(Value::as_array).into_iter().flatten())
        .find_map(|h| h.pointer("/result/url").and_then(Value::as_str))?;

    let html = http.get(song_url).send().await.ok()?.text().await.ok()?;
    let extracted = extract_genius_html(&html)?;
    let lines = lrc::plain_lines(&extracted);
    if lines.is_empty() {
        None
    } else {
        Some(Lyrics {
            source: "Genius".to_owned(),
            synced: false,
            lines,
            orig_duration_ms: None,
            adapted: None,
        })
    }
}

fn extract_genius_html(html: &str) -> Option<String> {
    let container_re = Regex::new(r#"(?s)data-lyrics-container="true"[^>]*>(.*?)</div>"#).ok()?;
    let br_re = Regex::new(r"(?i)<br\s*/?>").ok()?;
    let tag_re = Regex::new(r"(?s)<[^>]+>").ok()?;
    let mut chunks = Vec::new();
    for cap in container_re.captures_iter(html) {
        let with_nl = br_re.replace_all(&cap[1], "\n");
        let stripped = tag_re.replace_all(&with_nl, "");
        let decoded = stripped
            .replace("&amp;", "&")
            .replace("&quot;", "\"")
            .replace("&#x27;", "'")
            .replace("&apos;", "'")
            .replace("&lt;", "<")
            .replace("&gt;", ">");
        if !decoded.trim().is_empty() {
            chunks.push(decoded);
        }
    }
    if chunks.is_empty() {
        None
    } else {
        Some(chunks.join("\n"))
    }
}
