use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use regex::Regex;

use crate::config::{CLIENT_ID_COOLDOWN, PLACEHOLDER_CLIENT_ID, WEB_ORIGIN};
use crate::error::{AppError, Result};

fn cached(cell: &'static OnceLock<Option<Regex>>, pattern: &str) -> Option<&'static Regex> {
    cell.get_or_init(|| Regex::new(pattern).ok()).as_ref()
}

fn script_regex() -> Option<&'static Regex> {
    static RE: OnceLock<Option<Regex>> = OnceLock::new();
    cached(
        &RE,
        r#"<script[^>]+src="(https://a-v2\.sndcdn\.com/assets/[^"]+\.js)""#,
    )
}

fn client_id_regex() -> Option<&'static Regex> {
    static RE: OnceLock<Option<Regex>> = OnceLock::new();
    cached(&RE, r#"client_id\s*[:=]\s*"?([A-Za-z0-9]{32})\b"#)
}

pub fn extract_script_urls(html: &str) -> Vec<String> {
    let Some(re) = script_regex() else {
        return Vec::new();
    };
    re.captures_iter(html)
        .filter_map(|caps| caps.get(1).map(|m| m.as_str().to_owned()))
        .collect()
}

pub fn extract_client_id(js: &str) -> Option<String> {
    client_id_regex()?
        .captures(js)
        .and_then(|caps| caps.get(1))
        .map(|m| m.as_str().to_owned())
}

pub async fn scrape(http: &reqwest::Client) -> Result<String> {
    let html = http.get(WEB_ORIGIN).send().await?.text().await?;
    let scripts = extract_script_urls(&html);
    for url in scripts.iter().rev() {
        let Ok(response) = http.get(url).send().await else {
            continue;
        };
        let Ok(body) = response.text().await else {
            continue;
        };
        if let Some(id) = extract_client_id(&body) {
            return Ok(id);
        }
    }
    Err(AppError::other("Не удалось получить client_id SoundCloud"))
}

pub struct ClientIdStore {
    path: PathBuf,
    current: Mutex<String>,
    last_attempt: Mutex<Option<Instant>>,
    gate: tokio::sync::Mutex<()>,
}

impl ClientIdStore {

    pub fn load(path: PathBuf) -> Self {
        let cached = std::fs::read_to_string(&path)
            .ok()
            .map(|s| s.trim().to_owned())
            .filter(|s| !s.is_empty());
        Self {
            path,
            current: Mutex::new(cached.unwrap_or_else(|| PLACEHOLDER_CLIENT_ID.to_owned())),
            last_attempt: Mutex::new(None),
            gate: tokio::sync::Mutex::new(()),
        }
    }

    pub fn current(&self) -> String {
        self.current
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
    }

    pub async fn ensure(&self, http: &reqwest::Client) -> String {
        if self.current() == PLACEHOLDER_CLIENT_ID {

            let _ = self.refresh(http, false).await;
        }
        self.current()
    }

    pub async fn refresh(&self, http: &reqwest::Client, force: bool) -> Result<Option<String>> {
        let _gate = self.gate.lock().await;
        if !force {
            let last = *self.last_attempt.lock().unwrap_or_else(|p| p.into_inner());
            if last.is_some_and(|at| at.elapsed() < CLIENT_ID_COOLDOWN) {
                return Ok(None);
            }
        }
        *self.last_attempt.lock().unwrap_or_else(|p| p.into_inner()) = Some(Instant::now());
        let id = scrape(http).await?;
        *self.current.lock().unwrap_or_else(|p| p.into_inner()) = id.clone();
        if let Err(err) = std::fs::write(&self.path, &id) {
            log::warn!("client_id cache write failed: {err}");
        }
        Ok(Some(id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BUNDLE: &str = r#"...e.exports={api_url:"https://api-v2.soundcloud.com",client_id:"aB3dE6gH9jK2mN5pQ8sT1vW4yZ7bC0eF",env:"production"};var x=1;"#;

    #[test]
    fn extracts_colon_form() {
        assert_eq!(
            extract_client_id(BUNDLE).as_deref(),
            Some("aB3dE6gH9jK2mN5pQ8sT1vW4yZ7bC0eF")
        );
    }

    #[test]
    fn extracts_query_form() {
        let js = "fetch(`https://api-v2.soundcloud.com/x?client_id=aB3dE6gH9jK2mN5pQ8sT1vW4yZ7bC0eF&a=1`)";
        assert_eq!(
            extract_client_id(js).as_deref(),
            Some("aB3dE6gH9jK2mN5pQ8sT1vW4yZ7bC0eF")
        );
    }

    #[test]
    fn rejects_wrong_length() {
        assert!(extract_client_id(r#"client_id:"short""#).is_none());
        assert!(extract_client_id("nothing here").is_none());
    }

    #[test]
    fn extracts_script_urls_in_order() {
        let html = r#"<html><script crossorigin src="https://a-v2.sndcdn.com/assets/0-abc.js"></script>
<script src="https://example.com/other.js"></script>
<script crossorigin src="https://a-v2.sndcdn.com/assets/49-def.js"></script></html>"#;
        assert_eq!(
            extract_script_urls(html),
            vec![
                "https://a-v2.sndcdn.com/assets/0-abc.js".to_owned(),
                "https://a-v2.sndcdn.com/assets/49-def.js".to_owned()
            ]
        );
    }
}
