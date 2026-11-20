use std::sync::RwLock;

use serde_json::Value;
use tauri::State;

use crate::config::{KEYRING_SERVICE, KEYRING_USER};
use crate::error::{AppError, ErrorKind, Result};
use crate::sc::client;
use crate::sc::{ScMethod, ScRequest};
use crate::AppState;

pub struct AuthStore {
    token: RwLock<Option<String>>,
}

impl AuthStore {

    pub fn load() -> Self {
        let initial = read_keyring().ok().flatten();
        Self {
            token: RwLock::new(initial),
        }
    }

    pub fn get(&self) -> Option<String> {
        self.token
            .read()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
    }

    pub fn set(&self, tok: Option<String>) -> Result<()> {
        match &tok {
            Some(v) => write_keyring(v)?,
            None => delete_keyring()?,
        }
        *self.token.write().unwrap_or_else(|p| p.into_inner()) = tok;
        Ok(())
    }
}

fn entry() -> Result<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| AppError::storage(format!("Keyring init failed: {e}")))
}

fn read_keyring() -> Result<Option<String>> {
    match entry()?.get_password() {
        Ok(s) => {
            let trimmed = s.trim().to_owned();
            if trimmed.is_empty() {
                Ok(None)
            } else {
                Ok(Some(trimmed))
            }
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::storage(format!("Keyring read failed: {e}"))),
    }
}

fn write_keyring(token: &str) -> Result<()> {
    entry()?
        .set_password(token)
        .map_err(|e| AppError::storage(format!("Keyring write failed: {e}")))
}

fn delete_keyring() -> Result<()> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::storage(format!("Keyring delete failed: {e}"))),
    }
}

fn normalize_token(raw: &str) -> Result<String> {
    let mut s = raw.trim();
    if let Some(rest) = s
        .strip_prefix("OAuth ")
        .or_else(|| s.strip_prefix("oauth "))
        .or_else(|| s.strip_prefix("Bearer "))
    {
        s = rest.trim();
    }
    if s.is_empty() {
        return Err(AppError::unauthorized());
    }
    Ok(s.to_owned())
}

#[tauri::command]
pub async fn auth_login(state: State<'_, AppState>, token: String) -> Result<Value> {
    let clean = normalize_token(&token)?;
    let prev = state.token.get();
    *state.token.token.write().unwrap_or_else(|p| p.into_inner()) = Some(clean.clone());

    let req = ScRequest {
        method: ScMethod::Get,
        url: "/me".to_owned(),
        query: None,
        body: None,
    };

    match client::request(&state, &req).await {
        Ok(user) => {
            if let Err(err) = write_keyring(&clean) {
                *state.token.token.write().unwrap_or_else(|p| p.into_inner()) = prev;
                return Err(err);
            }
            Ok(user)
        }
        Err(err) => {
            *state.token.token.write().unwrap_or_else(|p| p.into_inner()) = prev;
            Err(err)
        }
    }
}

#[tauri::command]
pub async fn auth_restore(state: State<'_, AppState>) -> Result<Option<Value>> {
    if state.token.get().is_none() {
        if let Some(disk_tok) = read_keyring()? {
            *state.token.token.write().unwrap_or_else(|p| p.into_inner()) = Some(disk_tok);
        } else {
            return Ok(None);
        }
    }

    let req = ScRequest {
        method: ScMethod::Get,
        url: "/me".to_owned(),
        query: None,
        body: None,
    };

    match client::request(&state, &req).await {
        Ok(user) => Ok(Some(user)),
        Err(err) if err.kind == ErrorKind::Unauthorized => {
            let _ = state.token.set(None);
            Err(err)
        }
        Err(err) => Err(err),
    }
}

#[tauri::command]
pub async fn auth_logout(state: State<'_, AppState>) -> Result<()> {
    state.token.set(None)
}

#[tauri::command]
pub async fn sc_open_verify(app: tauri::AppHandle, url: Option<String>) -> Result<()> {
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

    let captcha_url = url.filter(|u| {
        u.parse::<url::Url>()
            .ok()
            .and_then(|p| p.host_str().map(|h| h.ends_with("captcha-delivery.com")))
            .unwrap_or(false)
    });
    let home: url::Url = "https://soundcloud.com/"
        .parse()
        .map_err(|e| AppError::parse(format!("Invalid verify URL: {e}")))?;

    if let Some(existing) = app.get_webview_window("sc-verify") {
        let _ = existing.close();
    }

    let before = client::dd_cookie();

    let mut builder = WebviewWindowBuilder::new(&app, "sc-verify", WebviewUrl::External(home.clone()))
        .title("Проверка безопасности SoundCloud")
        .inner_size(520.0, 640.0)
        .center()
        .focused(true)
        .user_agent(crate::config::USER_AGENT)
        .additional_browser_args("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider --autoplay-policy=no-user-gesture-required --renderer-process-limit=1 --disable-background-networking --disable-breakpad --disable-component-update --disable-domain-reliability --disable-sync --metrics-recording-only --no-pings --disable-extensions");
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon)?;
    }

    if let Some(cu) = &captcha_url {

        let cu_json = serde_json::to_string(cu).unwrap_or_else(|_| "\"\"".to_owned());
        let script = format!(
            r#"(function(){{
  if(!location.hostname.endsWith('soundcloud.com')) return;
  var u = {cu_json};
  function mount(){{
    if(document.getElementById('arima-captcha')) return;
    var f = document.createElement('iframe');
    f.id = 'arima-captcha';
    f.src = u;
    f.setAttribute('allow','accelerometer; gyroscope');
    f.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;border:0;margin:0;padding:0;z-index:2147483647;background:#fff';
    document.documentElement.style.overflow = 'hidden';
    if(document.body) Array.prototype.forEach.call(document.body.children, function(c){{ if(c !== f) c.style.visibility = 'hidden'; }});
    document.documentElement.appendChild(f);
  }}
  if(document.readyState === 'complete') setTimeout(mount, 400);
  else window.addEventListener('load', function(){{ setTimeout(mount, 700); }});
}})();"#
        );
        builder = builder.initialization_script(&script);
    }

    let win = builder
        .build()
        .map_err(|e| AppError::other(format!("Failed to open verify window: {e}")))?;

    let mut waited_ms: u64 = 0;
    loop {
        tokio::time::sleep(std::time::Duration::from_millis(700)).await;
        waited_ms += 700;
        let Some(w) = app.get_webview_window("sc-verify") else {
            break;
        };
        if let Ok(cookies) = w.cookies_for_url(home.clone()) {
            if let Some(c) = cookies.iter().find(|c| c.name() == "datadome") {
                let val = c.value().to_owned();
                if !val.is_empty() && Some(&val) != before.as_ref() {
                    client::set_dd_cookie(Some(val));
                    let _ = w.close();
                    break;
                }
            }
        }
        if waited_ms > 240_000 {
            let _ = w.close();
            break;
        }
    }
    drop(win);
    Ok(())
}

#[tauri::command]
pub async fn sc_like_webview(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    track_id: u64,
    user_id: u64,
    liked: bool,
) -> Result<()> {
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

    const LABEL: &str = "sc-like";
    let http = state.http.get();
    let client_id = state.client_id.ensure(&http).await.to_string();
    let token = state.token.get().ok_or_else(AppError::unauthorized)?;

    let home: url::Url = "https://soundcloud.com/"
        .parse()
        .map_err(|e| AppError::parse(format!("Invalid URL: {e}")))?;
    let api = format!(
        "https://api-v2.soundcloud.com/users/{user_id}/track_likes/{track_id}?client_id={client_id}"
    );
    let cfg = serde_json::json!({
        "url": api,
        "method": if liked { "PUT" } else { "DELETE" },
        "token": token,
    })
    .to_string();

    let script = format!(
        r#"(function(){{
  if(!/(^|\.)soundcloud\.com$/.test(location.hostname)) return;
  if(window.__arimaInit) return; window.__arimaInit = true;
  var CFG = {cfg};
  function setRes(v){{ document.cookie = 'arima_like=' + v + '; domain=.soundcloud.com; path=/; max-age=300'; }}
  window.__arimaAttempt = function(){{
    setRes('pending');
    function run(cred){{
      return fetch(CFG.url, {{ method: CFG.method, credentials: cred,
        headers: {{ 'Authorization': 'OAuth ' + CFG.token, 'Accept': 'application/json, text/javascript, */*; q=0.01' }} }});
    }}
    run('include').catch(function(){{ return run('omit'); }}).then(function(r){{
      if(r.ok){{ setRes('ok'); return; }}
      return r.text().then(function(t){{
        var u = '';
        try {{ var j = JSON.parse(t); if(j && j.url) u = j.url; }} catch(e){{}}
        if(!u){{ var m = t.match(/https:\/\/[^"'\s\\<>]*captcha-delivery\.com[^"'\s\\<>]*/); if(m) u = m[0]; }}
        if(u && u.indexOf('captcha-delivery.com') >= 0) setRes('captcha|' + encodeURIComponent(u));
        else setRes('err|' + r.status);
      }});
    }}).catch(function(){{ setRes('err|0'); }});
  }};
  function start(){{ setTimeout(window.__arimaAttempt, 900); }}
  if(document.readyState === 'complete') start(); else window.addEventListener('load', start);
}})();"#
    );

    if let Some(existing) = app.get_webview_window(LABEL) {
        let _ = existing.close();
    }

    let mut builder = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::External(home.clone()))
        .title("Проверка безопасности SoundCloud")
        .inner_size(520.0, 640.0)
        .center()
        .visible(false)
        .user_agent(crate::config::USER_AGENT)
        .additional_browser_args("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider --autoplay-policy=no-user-gesture-required --renderer-process-limit=1 --disable-background-networking --disable-breakpad --disable-component-update --disable-domain-reliability --disable-sync --metrics-recording-only --no-pings --disable-extensions")
        .initialization_script(&script);
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon)?;
    }
    let win = builder
        .build()
        .map_err(|e| AppError::other(format!("Failed to open window: {e}")))?;

    let mut waited_ms: u64 = 0;
    let mut shown = false;
    let mut last_retry: u64 = 0;
    let outcome: Result<()> = loop {
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
        waited_ms += 400;
        let Some(w) = app.get_webview_window(LABEL) else {
            break Err(AppError::forbidden());
        };
        let val = w.cookies_for_url(home.clone()).ok().and_then(|cs| {
            cs.iter()
                .find(|c| c.name() == "arima_like")
                .map(|c| c.value().to_owned())
        });
        match val.as_deref() {
            Some("ok") => break Ok(()),
            Some(v) if v.starts_with("captcha|") => {
                if !shown {
                    shown = true;
                    last_retry = waited_ms;
                    let decoded = urlencoding::decode(&v["captcha|".len()..])
                        .map(|c| c.into_owned())
                        .unwrap_or_default();
                    let u_json = serde_json::to_string(&decoded).unwrap_or_else(|_| "\"\"".to_owned());
                    let mount = format!(
                        r#"(function(){{
  var u = {u_json};
  if(document.getElementById('arima-captcha')) return;
  var f = document.createElement('iframe');
  f.id = 'arima-captcha'; f.src = u;
  f.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;border:0;margin:0;padding:0;z-index:2147483647;background:#fff';
  document.documentElement.style.overflow = 'hidden';
  if(document.body) Array.prototype.forEach.call(document.body.children, function(c){{ c.style.visibility = 'hidden'; }});
  document.documentElement.appendChild(f);
}})();"#
                    );
                    let _ = w.eval(&mount);
                    let _ = w.show();
                    let _ = w.set_focus();
                } else if waited_ms - last_retry >= 3200 {
                    last_retry = waited_ms;
                    let _ = w.eval("window.__arimaAttempt && window.__arimaAttempt()");
                }
            }
            Some(v) if v.starts_with("err|") => {
                break Err(match &v[4..] {
                    "404" => AppError::not_found(),
                    "401" => AppError::unauthorized(),
                    _ => AppError::forbidden(),
                });
            }
            _ => {}
        }
        if waited_ms > 240_000 {
            break Err(AppError::forbidden());
        }
    };
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.close();
    }
    drop(win);
    outcome
}
