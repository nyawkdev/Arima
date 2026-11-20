use std::sync::RwLock;
use std::time::Duration;

use reqwest::header::{HeaderMap, ACCEPT, AUTHORIZATION, COOKIE, ORIGIN, REFERER, RETRY_AFTER, SET_COOKIE};
use reqwest::{Method, StatusCode};
use serde_json::{json, Value};
use url::Url;

use super::{ScMethod, ScRequest};
use crate::config::{
    API_BASE, API_HOST, MAX_RATE_RETRIES, MAX_RETRY_AFTER, USER_AGENT, WEB_ORIGIN,
};
use crate::error::{AppError, Result};
use crate::stream_proxy;
use crate::AppState;

pub fn build_client(proxy: &str) -> Result<reqwest::Client> {
    let mut builder = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .pool_max_idle_per_host(2)
        .pool_idle_timeout(Duration::from_secs(15))
        .gzip(true);
    let proxy = proxy.trim();
    if !proxy.is_empty() {
        let proxy = reqwest::Proxy::all(proxy)
            .map_err(|err| AppError::other(format!("Некорректный прокси: {err}")))?;
        builder = builder.proxy(proxy);
    }
    builder
        .build()
        .map_err(|err| AppError::network(err.to_string()))
}

pub struct HttpClient(RwLock<reqwest::Client>);

impl HttpClient {

    pub fn new(proxy: &str) -> Result<Self> {
        Ok(Self(RwLock::new(build_client(proxy)?)))
    }

    pub fn get(&self) -> reqwest::Client {
        self.0
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    pub fn rebuild(&self, proxy: &str) -> Result<()> {
        let client = build_client(proxy)?;
        *self
            .0
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = client;
        Ok(())
    }
}

fn build_url(req: &ScRequest, client_id: &str) -> Result<Url> {
    let mut url = if req.url.starts_with("http://") || req.url.starts_with("https://") {
        Url::parse(&req.url)?
    } else {
        Url::parse(API_BASE)?.join(&req.url)?
    };
    if url.scheme() != "https" || url.host_str() != Some(API_HOST) {
        return Err(AppError::other("Недопустимый хост запроса"));
    }
    let mut pairs: Vec<(String, String)> = url
        .query_pairs()
        .filter(|(key, _)| key != "client_id")
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();
    if let Some(query) = &req.query {
        for (key, value) in query {
            pairs.retain(|(existing, _)| existing != key);
            pairs.push((key.clone(), value.clone()));
        }
    }
    pairs.push(("client_id".to_owned(), client_id.to_owned()));
    url.query_pairs_mut().clear().extend_pairs(pairs);
    Ok(url)
}

fn retry_after_secs(headers: &HeaderMap) -> Option<u64> {
    headers
        .get(RETRY_AFTER)?
        .to_str()
        .ok()?
        .trim()
        .parse::<u64>()
        .ok()
}

fn to_method(method: ScMethod) -> Method {
    match method {
        ScMethod::Get => Method::GET,
        ScMethod::Post => Method::POST,
        ScMethod::Put => Method::PUT,
        ScMethod::Delete => Method::DELETE,
    }
}

fn requires_user_auth(req: &ScRequest) -> bool {
    if !matches!(req.method, ScMethod::Get) {
        return true;
    }
    let u = req.url.as_str();
    u.contains("/me")
        || u.contains("/track_likes")
        || u.contains("/playlist_likes")
        || u.contains("/playlists_without_albums")
        || u.contains("/followings")
}

pub static DD_COOKIE: RwLock<Option<String>> = RwLock::new(None);

pub fn dd_cookie() -> Option<String> {
    DD_COOKIE.read().unwrap_or_else(|p| p.into_inner()).clone()
}

pub fn set_dd_cookie(value: Option<String>) {
    *DD_COOKIE.write().unwrap_or_else(|p| p.into_inner()) = value;
}

fn extract_captcha_url(body: &str) -> Option<String> {
    if let Ok(v) = serde_json::from_str::<Value>(body) {
        if let Some(u) = v.get("url").and_then(Value::as_str) {
            if u.contains("captcha-delivery.com") {
                return Some(u.to_owned());
            }
        }
    }
    let re = regex::Regex::new(r#"https://[^"'\s\\<>]*captcha-delivery\.com[^"'\s\\<>]*"#).ok()?;
    re.find(body).map(|m| m.as_str().replace("&amp;", "&"))
}

async fn send_once(
    state: &AppState,
    http: &reqwest::Client,
    req: &ScRequest,
    client_id: &str,
    force_auth: bool,
) -> Result<reqwest::Response> {
    let url = build_url(req, client_id)?;
    let mut builder = http
        .request(to_method(req.method), url)
        .header(ACCEPT, "application/json, text/javascript, */*; q=0.01")
        .header(ORIGIN, WEB_ORIGIN)
        .header(REFERER, format!("{WEB_ORIGIN}/"));
    if let Some(dd) = dd_cookie() {
        builder = builder.header(COOKIE, format!("datadome={dd}"));
    }
    if requires_user_auth(req) || force_auth {
        if let Some(token) = state.token.get() {
            builder = builder.header(AUTHORIZATION, format!("OAuth {token}"));
        }
    }
    if matches!(req.method, ScMethod::Post | ScMethod::Put) {
        if let Some(body) = &req.body {
            builder = builder.json(body);
        } else {
            builder = builder.header(reqwest::header::CONTENT_LENGTH, 0).body(Vec::new());
        }
    }
    Ok(builder.send().await?)
}

pub async fn request(state: &AppState, req: &ScRequest) -> Result<Value> {
    let mut http = state.http.get();
    let mut rate_retries = 0;
    let mut server_retries: u64 = 0;
    let mut refreshed = false;
    loop {
        let client_id = state.client_id.ensure(&http).await;
        let force_auth = server_retries >= 1;
        let response = send_once(state, &http, req, &client_id, force_auth).await?;
        let status = response.status();
        if status.is_success() {
            let bytes = response.bytes().await?;
            if bytes.iter().all(u8::is_ascii_whitespace) {
                return Ok(Value::Null);
            }
            return serde_json::from_slice(&bytes).map_err(AppError::from);
        }
        match status {
            StatusCode::TOO_MANY_REQUESTS => {
                let wait = retry_after_secs(response.headers()).unwrap_or(1);
                if rate_retries < MAX_RATE_RETRIES {
                    rate_retries += 1;
                    tokio::time::sleep(Duration::from_secs(wait).min(MAX_RETRY_AFTER)).await;
                    continue;
                }
                return Err(AppError::rate_limited(wait));
            }
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
                if status == StatusCode::FORBIDDEN {
                    let set_cookies: Vec<String> = response
                        .headers()
                        .get_all(SET_COOKIE)
                        .iter()
                        .filter_map(|v| v.to_str().ok().map(str::to_owned))
                        .collect();
                    let body = response.text().await.unwrap_or_default();
                    if let Some(captcha) = extract_captcha_url(&body) {
                        if let Some(dd) = set_cookies.iter().find_map(|c| {
                            c.strip_prefix("datadome=")
                                .map(|rest| rest.split(';').next().unwrap_or("").to_owned())
                        }) {
                            if !dd.is_empty() {
                                set_dd_cookie(Some(dd));
                            }
                        }
                        return Err(AppError::captcha(captcha));
                    }
                }
                if !refreshed {
                    refreshed = true;
                    let rotated = state.client_id.current() != client_id
                        || matches!(state.client_id.refresh(&http, false).await, Ok(Some(_)));
                    if rotated {
                        continue;
                    }
                }
                return Err(if status == StatusCode::UNAUTHORIZED {
                    AppError::unauthorized()
                } else {
                    AppError::forbidden()
                });
            }
            StatusCode::NOT_FOUND => return Err(AppError::not_found()),
            StatusCode::INTERNAL_SERVER_ERROR
            | StatusCode::BAD_GATEWAY
            | StatusCode::SERVICE_UNAVAILABLE
            | StatusCode::GATEWAY_TIMEOUT => {
                if server_retries < 2 {
                    server_retries += 1;
                    if server_retries == 1 && !requires_user_auth(req) {

                        set_dd_cookie(None);
                    } else if server_retries == 2 && !refreshed {
                        refreshed = true;
                        let _ = state.client_id.refresh(&http, true).await;

                        if let Ok(fresh) = reqwest::Client::builder()
                            .user_agent(USER_AGENT)
                            .http1_only()
                            .connect_timeout(Duration::from_secs(10))
                            .timeout(Duration::from_secs(30))
                            .gzip(true)
                            .build()
                        {
                            http = fresh;
                        }
                    }
                    tokio::time::sleep(Duration::from_millis(250 * server_retries)).await;
                    continue;
                }
                return Err(AppError::other(format!(
                    "SoundCloud вернул статус {}",
                    status.as_u16()
                )));
            }
            other => {
                return Err(AppError::other(format!(
                    "SoundCloud вернул статус {}",
                    other.as_u16()
                )))
            }
        }
    }
}

pub async fn resolve_stream(
    state: &AppState,
    transcoding_url: &str,
    track_authorization: Option<&str>,
) -> Result<String> {
    let query = track_authorization
        .filter(|value| !value.is_empty())
        .map(|value| {
            std::collections::HashMap::from([("track_authorization".to_owned(), value.to_owned())])
        });
    let req = ScRequest {
        method: ScMethod::Get,
        url: transcoding_url.to_owned(),
        query,
        body: None,
    };
    let value = request(state, &req).await?;
    let upstream = value
        .get("url")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::parse(format!("Нет поля url в ответе: {}", json!(value))))?;
    Ok(stream_proxy::encode_proxy_url(upstream))
}

pub async fn web_search(state: &AppState, q: &str, kind: &str) -> Result<Value> {
    let segment = match kind {
        "users" => "people",
        "playlists" | "albums" => "sets",
        _ => "sounds",
    };
    let mut url = Url::parse(&format!("{WEB_ORIGIN}/search/{segment}"))?;
    url.query_pairs_mut().append_pair("q", q);
    let http = state.http.get();
    let html = http
        .get(url)
        .header(ACCEPT, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .send()
        .await?
        .text()
        .await?;

    let marker = "window.__sc_hydration = ";
    let Some(start) = html.find(marker) else {
        return Ok(json!({ "collection": [], "next_href": null }));
    };
    let rest = &html[start + marker.len()..];
    let Some(end) = rest.find(";</script>") else {
        return Ok(json!({ "collection": [], "next_href": null }));
    };
    let hydration: Value = serde_json::from_str(&rest[..end])?;
    if let Some(arr) = hydration.as_array() {
        for item in arr {
            if item.get("hydratable").and_then(Value::as_str) == Some("search") {
                if let Some(data) = item.get("data") {
                    return Ok(data.clone());
                }
            }
        }
    }
    Ok(json!({ "collection": [], "next_href": null }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn req(url: &str, query: Option<HashMap<String, String>>) -> ScRequest {
        ScRequest {
            method: ScMethod::Get,
            url: url.to_owned(),
            query,
            body: None,
        }
    }

    #[test]
    fn relative_path_gets_client_id() {
        let url = build_url(&req("/me/likes?limit=10", None), "abc").map(|u| u.to_string());
        assert_eq!(
            url.as_deref().ok(),
            Some("https://api-v2.soundcloud.com/me/likes?limit=10&client_id=abc")
        );
    }

    #[test]
    fn absolute_next_href_replaces_stale_client_id() {
        let href = "https://api-v2.soundcloud.com/me/likes?offset=5&client_id=old";
        let query = HashMap::from([("limit".to_owned(), "5".to_owned())]);
        let url = build_url(&req(href, Some(query)), "new").map(|u| u.to_string());
        assert_eq!(
            url.as_deref().ok(),
            Some("https://api-v2.soundcloud.com/me/likes?offset=5&limit=5&client_id=new")
        );
    }

    #[test]
    fn foreign_hosts_are_rejected() {
        assert!(build_url(&req("https://evil.example/x", None), "abc").is_err());
        assert!(build_url(&req("//evil.example/x", None), "abc").is_err());
        assert!(build_url(&req("http://api-v2.soundcloud.com/x", None), "abc").is_err());
    }

    #[test]
    fn parses_retry_after() {
        let mut headers = HeaderMap::new();
        headers.insert(RETRY_AFTER, "7".parse().unwrap_or_else(|_| "0".parse().unwrap()));
        assert_eq!(retry_after_secs(&headers), Some(7));
    }
}
