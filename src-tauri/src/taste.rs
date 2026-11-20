use std::collections::{HashMap, HashSet};

use serde::Serialize;

const HALF_LIFE_MS: f64 = 30.0 * 24.0 * 60.0 * 60.0 * 1000.0;
const SKIP_PENALTY_WINDOW_MS: i64 = 14 * 24 * 60 * 60 * 1000;
const MAX_RECENT_IDS: usize = 300;

#[derive(Debug, Clone)]
pub struct PlayRecord {
    pub track_id: i64,
    pub played_at: i64,
    pub listened_ms: i64,
    pub duration_ms: i64,
    pub completed: bool,
    pub skipped: bool,
    pub genre: String,
    pub artist_id: String,
    pub tag_list: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TasteProfile {
    pub genres: HashMap<String, f64>,
    pub artists: HashMap<String, f64>,
    pub tags: HashMap<String, f64>,
    pub recent_ids: Vec<i64>,
    pub skipped_ids: Vec<i64>,
    pub total_plays: i64,
}

pub fn parse_tags(raw: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut chars = raw.chars().peekable();
    while let Some(&c) = chars.peek() {
        if c.is_whitespace() {
            chars.next();
            continue;
        }
        if c == '"' {
            chars.next();
            let mut buf = String::new();
            for ch in chars.by_ref() {
                if ch == '"' {
                    break;
                }
                buf.push(ch);
            }
            let norm = buf.trim().to_lowercase();
            if !norm.is_empty() {
                out.push(norm);
            }
        } else {
            let mut buf = String::new();
            while let Some(&ch) = chars.peek() {
                if ch.is_whitespace() {
                    break;
                }
                buf.push(ch);
                chars.next();
            }
            let norm = buf.trim().to_lowercase();
            if !norm.is_empty() {
                out.push(norm);
            }
        }
    }
    out
}

fn normalize_map(map: &mut HashMap<String, f64>) {
    map.retain(|_, v| *v > 0.0);
    let max = map.values().copied().fold(0.0_f64, f64::max);
    if max > 0.0 {
        for v in map.values_mut() {
            *v /= max;
        }
    }
}

pub fn build_profile(records: &[PlayRecord], now_ms: i64) -> TasteProfile {
    let mut genres: HashMap<String, f64> = HashMap::new();
    let mut artists: HashMap<String, f64> = HashMap::new();
    let mut tags: HashMap<String, f64> = HashMap::new();
    let mut recent_seen: HashSet<i64> = HashSet::new();
    let mut recent_ids: Vec<i64> = Vec::new();
    let mut skipped_seen: HashSet<i64> = HashSet::new();
    let mut skipped_ids: Vec<i64> = Vec::new();

    for r in records {
        if recent_ids.len() < MAX_RECENT_IDS && recent_seen.insert(r.track_id) {
            recent_ids.push(r.track_id);
        }
        if r.skipped
            && now_ms.saturating_sub(r.played_at) <= SKIP_PENALTY_WINDOW_MS
            && skipped_seen.insert(r.track_id)
        {
            skipped_ids.push(r.track_id);
        }

        let ratio = if r.duration_ms > 0 {
            (r.listened_ms as f64 / r.duration_ms as f64).clamp(0.0, 1.0)
        } else {
            0.5
        };
        let mut weight = if r.skipped && r.listened_ms < 30_000 {
            -1.0
        } else {
            ratio * if r.completed { 1.5 } else { 1.0 }
        };

        let age = (now_ms.saturating_sub(r.played_at)).max(0) as f64;
        let decay = 0.5_f64.powf(age / HALF_LIFE_MS);
        weight *= decay;

        let genre = r.genre.trim().to_lowercase();
        if !genre.is_empty() {
            *genres.entry(genre).or_insert(0.0) += weight;
        }
        if !r.artist_id.is_empty() {
            *artists.entry(r.artist_id.clone()).or_insert(0.0) += weight;
        }
        for tag in parse_tags(&r.tag_list) {
            *tags.entry(tag).or_insert(0.0) += weight;
        }
    }

    normalize_map(&mut genres);
    normalize_map(&mut artists);
    normalize_map(&mut tags);

    TasteProfile {
        genres,
        artists,
        tags,
        recent_ids,
        skipped_ids,
        total_plays: records.len() as i64,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_quoted_and_bare_tags() {
        assert_eq!(
            parse_tags(r#""Deep House" Techno  "Lo-Fi Beats" ambient"#),
            vec!["deep house", "techno", "lo-fi beats", "ambient"]
        );
    }

    #[test]
    fn normalizes_weights_and_penalizes_early_skips() {
        let now = 1_000_000_000_i64;
        let records = vec![
            PlayRecord {
                track_id: 1,
                played_at: now,
                listened_ms: 180_000,
                duration_ms: 180_000,
                completed: true,
                skipped: false,
                genre: "Ambient".into(),
                artist_id: "10".into(),
                tag_list: "ambient drone".into(),
            },
            PlayRecord {
                track_id: 2,
                played_at: now,
                listened_ms: 8_000,
                duration_ms: 180_000,
                completed: false,
                skipped: true,
                genre: "Pop".into(),
                artist_id: "20".into(),
                tag_list: "pop".into(),
            },
        ];
        let p = build_profile(&records, now);
        assert_eq!(p.genres.get("ambient").copied(), Some(1.0));
        assert!(!p.genres.contains_key("pop"));
        assert_eq!(p.skipped_ids, vec![2]);
        assert_eq!(p.recent_ids, vec![1, 2]);
    }
}
