use regex::Regex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LyricLine {
    pub t: i64,
    pub text: String,
}

pub fn parse(raw: &str) -> Vec<LyricLine> {
    let tag_re = Regex::new(r"\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]").expect("valid regex");
    let offset_re = Regex::new(r"(?i)\[offset:\s*([+-]?\d+)\s*\]").expect("valid regex");

    let mut offset_ms: i64 = 0;
    for line in raw.lines() {
        if let Some(cap) = offset_re.captures(line) {
            if let Ok(v) = cap[1].parse::<i64>() {
                offset_ms = v;
            }
        }
    }

    let mut out = Vec::new();
    for line in raw.lines() {
        let matches: Vec<_> = tag_re.captures_iter(line).collect();
        if matches.is_empty() {
            continue;
        }
        let text = tag_re.replace_all(line, "").trim().to_owned();
        if text.is_empty() {
            continue;
        }
        for cap in matches {
            let min: i64 = cap[1].parse().unwrap_or(0);
            let sec: i64 = cap[2].parse().unwrap_or(0);
            let frac_str = cap.get(3).map(|m| m.as_str()).unwrap_or("");
            let ms: i64 = match frac_str.len() {
                0 => 0,
                1 => frac_str.parse::<i64>().unwrap_or(0) * 100,
                2 => frac_str.parse::<i64>().unwrap_or(0) * 10,
                _ => frac_str[..3].parse::<i64>().unwrap_or(0),
            };
            let t = (min * 60_000 + sec * 1000 + ms + offset_ms).max(0);
            out.push(LyricLine {
                t,
                text: text.clone(),
            });
        }
    }

    out.sort_by_key(|l| l.t);
    out
}

pub fn plain_lines(raw: &str) -> Vec<LyricLine> {
    raw.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(|l| LyricLine {
            t: -1,
            text: l.to_owned(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_standard_and_multi_timestamps_with_offset() {
        let lrc = "\
[ar:Artist]
[offset:500]
[00:10.50][00:25.123]Chorus line
[00:05.00]First line
[00:15.00]
";
        let lines = parse(lrc);
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0].t, 5_500);
        assert_eq!(lines[0].text, "First line");
        assert_eq!(lines[1].t, 11_000);
        assert_eq!(lines[1].text, "Chorus line");
        assert_eq!(lines[2].t, 25_623);
        assert_eq!(lines[2].text, "Chorus line");
    }
}
