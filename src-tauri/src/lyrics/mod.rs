pub mod genius;
pub mod kugou;
pub mod lrc;
pub mod lrclib;
pub mod lyricsovh;
pub mod musixmatch;
pub mod netease;

use std::collections::HashSet;

use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::config::LYRICS_TIMEOUT;
use crate::error::Result;
use crate::AppState;

use self::lrc::LyricLine;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsRequest {
    pub track_id: i64,
    pub title: String,
    pub artist: String,
    pub duration_ms: i64,
}

#[derive(Debug, Clone)]
pub struct LyricsQuery {
    pub title: String,
    pub artist: String,
    pub duration_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Lyrics {
    pub source: String,
    pub synced: bool,
    pub lines: Vec<LyricLine>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub orig_duration_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub adapted: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TrackVariant {
    Original,
    Slowed,
    SpeedUp,
    Remix,
}

fn detect_variant(title: &str) -> (TrackVariant, f64, &'static str) {
    let lc = title.to_lowercase();
    if lc.contains("slowed") || lc.contains("chopped") || lc.contains("screwed") {
        (TrackVariant::Slowed, 0.84, "slowed")
    } else if lc.contains("speed up") || lc.contains("sped up") || lc.contains("nightcore") {
        (TrackVariant::SpeedUp, 1.22, "speed up")
    } else if lc.contains("remix") || lc.contains("bootleg") || lc.contains("flip") || lc.contains("rmx") {
        (TrackVariant::Remix, 1.0, "remix")
    } else {
        (TrackVariant::Original, 1.0, "")
    }
}

fn adapt_to_variant(res: &mut Lyrics, variant: TrackVariant, label: &str, sc_duration_ms: i64) {
    if !res.synced || res.lines.is_empty() || sc_duration_ms <= 0 {
        return;
    }
    let ratio = if let Some(orig) = res.orig_duration_ms.filter(|&d| d > 10_000) {
        let r = sc_duration_ms as f64 / orig as f64;
        if (0.68..=1.45).contains(&r) && (r - 1.0).abs() > 0.035 {
            Some(r)
        } else {
            None
        }
    } else {
        match variant {
            TrackVariant::Slowed => Some(1.18),
            TrackVariant::SpeedUp => Some(0.82),
            _ => None,
        }
    };

    if let Some(r) = ratio {
        for line in &mut res.lines {
            if line.t >= 0 {
                line.t = ((line.t as f64) * r).round() as i64;
            }
        }
        let tag = if label.is_empty() { "тайминг" } else { label };
        res.adapted = Some(format!("ИИ: адаптировано под {tag} (×{r:.2})"));
    }
}

fn strip_noise(raw: &str) -> String {
    let cleaned_chars: String = raw
        .chars()
        .filter(|&c| {
            let u = c as u32;

            !(0x0300..=0x036F).contains(&u)
                && !(0x0483..=0x0489).contains(&u)
                && u != 0x3164
                && !(0x200B..=0x200F).contains(&u)
                && u != 0xFEFF
        })
        .collect();

    let url_re = Regex::new(r"https?://\S+|@\S+|#\S+").expect("regex");
    let bracket_re = Regex::new(r"[\(\[\{【（]([^\)\]\}】）]+)[\)\]\}】）]").expect("regex");
    let tail_re = Regex::new(
        r"(?i)\s*(feat\.?|ft\.?|featuring|prod\.?\s*by|prod\.?|прод\.?\s*by|прод\.?|produced\s+by|без\s+цензуры|uncensored|explicit|clean|slowed|reverb|speed\s*up|sped\s*up|nightcore|bass\s*boosted|official\s+video|official\s+audio|music\s+video|lyric\s+video|lyrics|visualizer|snippet|full\s+version|live|cover|remix|remastered|бонус|bonus|слив|demo|hd|hq|8d\s+audio).*$",
    )
    .expect("regex");

    let noise_kw = [
        "official", "video", "audio", "lyric", "lyrics", "visualizer", "prod", "прод", "feat", "ft.",
        "slowed", "reverb", "speed up", "sped up", "nightcore", "bass", "boosted", "uncensored",
        "цензур", "explicit", "clean", "snippet", "leak", "слив", "full", "live", "cover", "remaster",
        "бонус", "bonus", "hq", "hd", "4k", "8d", "vip", "edit", "version", "inst", "instrumental",
    ];

    let s = url_re.replace_all(&cleaned_chars, " ");
    let s = bracket_re.replace_all(&s, |caps: &regex::Captures<'_>| {
        let inner = caps[1].to_lowercase();
        if noise_kw.iter().any(|kw| inner.contains(kw)) {
            " ".to_owned()
        } else {
            format!(" {}", &caps[1])
        }
    });
    let s = tail_re.replace_all(&s, "");
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn split_artists(raw_artist: &str) -> Vec<String> {
    let sep_re = Regex::new(r"(?i)\s*(?:,|&|\+|/|\bx\b|\bfeat\.?\b|\bft\.?\b|\band\b|\bи\b)\s*").expect("regex");
    let mut out: Vec<String> = Vec::new();
    let trimmed = raw_artist.trim();
    if !trimmed.is_empty() {
        out.push(trimmed.to_owned());
    }
    for part in sep_re.split(trimmed) {
        let p = part.trim();
        if p.len() >= 2 && !out.iter().any(|x| x.eq_ignore_ascii_case(p)) {
            out.push(p.to_owned());
        }
    }
    out
}

fn build_candidates(req: &LyricsRequest, search_duration_ms: i64) -> Vec<LyricsQuery> {
    let cleaned_title = strip_noise(&req.title);
    let cleaned_artist = strip_noise(&req.artist);
    let mut out: Vec<LyricsQuery> = Vec::new();
    let mut seen: HashSet<(String, String)> = HashSet::new();

    let mut push = |artist: String, title: String| {
        let a = artist.trim().to_owned();
        let t = title.trim().to_owned();
        if t.is_empty() {
            return;
        }
        let key = (a.to_lowercase(), t.to_lowercase());
        if seen.insert(key) {
            out.push(LyricsQuery {
                title: t,
                artist: a,
                duration_ms: search_duration_ms,
            });
        }
    };

    let normalized_sep = cleaned_title
        .replace(" — ", " - ")
        .replace(" – ", " - ")
        .replace(" || ", " - ");
    if let Some((left, right)) = normalized_sep.split_once(" - ") {
        let l = left.trim().to_owned();
        let r = right.trim().to_owned();
        if !l.is_empty() && !r.is_empty() {
            for a in split_artists(&l) {
                push(a, r.clone());
            }
            for a in split_artists(&r) {
                push(a, l.clone());
            }
        }
    }

    for a in split_artists(&cleaned_artist) {
        push(a, cleaned_title.clone());
    }

    if !cleaned_artist.is_empty() {
        push(String::new(), cleaned_title);
    }
    out
}

pub fn is_valid_lyrics(l: &Lyrics) -> bool {
    if l.lines.len() < 3 {
        return false;
    }
    let full: String = l
        .lines
        .iter()
        .map(|x| x.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    let lower = full.to_lowercase();
    if lower.contains("wob gopini")
        || lower.contains("lorem ipsum")
        || lower.contains("lyrics not found")
        || lower.contains("we are not licensed")
    {
        return false;
    }
    let words: Vec<&str> = lower.split_whitespace().collect();
    if words.len() < 8 {
        return false;
    }

    let unique: HashSet<&str> = words.iter().copied().collect();
    if words.len() > 25 && unique.len() as f64 / words.len() as f64 > 0.96 && !l.synced {
        return false;
    }
    true
}

#[tauri::command]
pub async fn lyrics_fetch(state: State<'_, AppState>, q: LyricsRequest) -> Result<Option<Lyrics>> {
    if let Ok(Some(cached)) = state.db.get_lyrics(q.track_id) {
        if cached.as_ref().map_or(true, is_valid_lyrics) {
            return Ok(cached);
        }
    }

    let http = state.http.get();
    let (variant, scale, label) = detect_variant(&q.title);
    let search_dur = if q.duration_ms > 0 && variant != TrackVariant::Original {
        ((q.duration_ms as f64) * scale).round() as i64
    } else {
        q.duration_ms
    };
    let candidates = build_candidates(&q, search_dur);
    let mut first_plain: Option<Lyrics> = None;

    macro_rules! try_provider {
        ($mod_name:ident) => {
            for cand in &candidates {
                if let Ok(Some(mut res)) =
                    tokio::time::timeout(LYRICS_TIMEOUT, $mod_name::fetch(&http, cand)).await
                {
                    if !is_valid_lyrics(&res) {
                        continue;
                    }
                    if res.synced {
                        adapt_to_variant(&mut res, variant, label, q.duration_ms);
                        let _ = state.db.put_lyrics(q.track_id, Some(&res));
                        return Ok(Some(res));
                    }
                    if first_plain.is_none() {
                        first_plain = Some(res);
                    }
                    break;
                }
            }
        };
    }

    try_provider!(lrclib);
    try_provider!(kugou);
    try_provider!(netease);
    try_provider!(musixmatch);
    try_provider!(genius);
    try_provider!(lyricsovh);

    let _ = state.db.put_lyrics(q.track_id, first_plain.as_ref());
    Ok(first_plain)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedMeta {
    pub title: String,
    pub artist: String,
    pub source: String,
}

#[tauri::command]
pub async fn metadata_resolve(
    state: State<'_, AppState>,
    title: String,
    artist: String,
) -> Result<Option<ResolvedMeta>> {
    let clean_t = strip_noise(&title);
    let clean_a = strip_noise(&artist);
    let term = if clean_a.is_empty() {
        clean_t.clone()
    } else {
        format!("{clean_a} {clean_t}")
    };
    if term.trim().len() < 2 {
        return Ok(None);
    }

    let http = state.http.get();
    let req = http
        .get("https://genius.com/api/search/multi")
        .query(&[("q", term.as_str())])
        .send();
    let Ok(Ok(resp)) = tokio::time::timeout(std::time::Duration::from_millis(2600), req).await
    else {
        return Ok(None);
    };
    if !resp.status().is_success() {
        return Ok(None);
    }
    let Ok(json) = resp.json::<serde_json::Value>().await else {
        return Ok(None);
    };
    let Some(sections) = json.pointer("/response/sections").and_then(|v| v.as_array()) else {
        return Ok(None);
    };

    let t_low = clean_t.to_lowercase();
    for s in sections {
        if s.get("type").and_then(|v| v.as_str()) != Some("song") {
            continue;
        }
        let Some(hits) = s.get("hits").and_then(|v| v.as_array()) else {
            continue;
        };
        for h in hits.iter().take(4) {
            let Some(res) = h.get("result") else { continue };
            let g_title = res.get("title").and_then(|v| v.as_str()).unwrap_or("").trim();
            let g_artist = res
                .get("artist_names")
                .and_then(|v| v.as_str())
                .or_else(|| res.pointer("/primary_artist/name").and_then(|v| v.as_str()))
                .unwrap_or("")
                .trim();
            if g_title.is_empty() || g_artist.is_empty() {
                continue;
            }
            let gt_low = g_title.to_lowercase();
            let ga_low = g_artist.to_lowercase();

            if t_low.contains(&gt_low)
                || gt_low.contains(&t_low)
                || (!clean_a.is_empty() && (ga_low.contains(&clean_a.to_lowercase()) || clean_a.to_lowercase().contains(&ga_low)))
            {
                return Ok(Some(ResolvedMeta {
                    title: g_title.to_owned(),
                    artist: g_artist.replace(" & ", ", "),
                    source: "Genius".to_owned(),
                }));
            }
        }
    }
    Ok(None)
}
