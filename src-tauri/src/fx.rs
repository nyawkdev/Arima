use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize};

use crate::config::MAIN_LABEL;
use crate::error::Result;
use crate::AppState;

pub const FX_LABEL: &str = "fx";

static FX_INTERNAL: AtomicBool = AtomicBool::new(false);
static LAST_RECT: Mutex<Option<FxRect>> = Mutex::new(None);

pub fn is_internal() -> bool {
    FX_INTERNAL.load(Ordering::Acquire)
}

pub fn record_main_rect(app: &AppHandle) {
    let Some(main) = app.get_webview_window(MAIN_LABEL) else {
        return;
    };
    if main.is_minimized().unwrap_or(false) || !main.is_visible().unwrap_or(false) {
        return;
    }
    let Some(mon) = main
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| main.primary_monitor().ok().flatten())
    else {
        return;
    };
    let scale = mon.scale_factor();
    let mon_pos = mon.position();
    if let (Ok(p), Ok(s)) = (main.outer_position(), main.outer_size()) {
        if p.x > -10000 && p.y > -10000 && s.width > 100 && s.height > 100 {
            if let Ok(mut g) = LAST_RECT.lock() {
                *g = Some(FxRect {
                    x: (p.x as f64 - mon_pos.x as f64) / scale,
                    y: (p.y as f64 - mon_pos.y as f64) / scale,
                    w: (s.width as f64) / scale,
                    h: (s.height as f64) / scale,
                });
            }
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FxRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FxPayload {
    pub kind: String,
    pub win_rect: FxRect,
    pub mon_w: f64,
    pub mon_h: f64,
    pub target_x: f64,
    pub target_y: f64,
    pub edge: String,
    pub accent: String,
}

pub fn is_enabled(app: &AppHandle) -> bool {
    let st = app.state::<AppState>();
    st.settings
        .get()
        .extra
        .get("ui")
        .and_then(|u| u.get("windowAnimations"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

fn current_accent(app: &AppHandle) -> String {
    let st = app.state::<AppState>();
    let s = st.settings.get();
    let ui = s.extra.get("ui");
    let preset = ui
        .and_then(|u| u.get("accentPreset"))
        .and_then(|v| v.as_str())
        .unwrap_or("amoled");
    match preset {
        "crimson" => "#e11d48".to_owned(),
        "nord" => "#60a5fa".to_owned(),
        "terminal" => "#16a34a".to_owned(),
        "aqua" => "#14b8a6".to_owned(),
        "sunset" => "#ea580c".to_owned(),
        "slate" => "#4f7df3".to_owned(),
        "custom" => ui
            .and_then(|u| u.get("customAccent"))
            .and_then(|v| v.as_str())
            .unwrap_or("#ffffff")
            .to_owned(),
        _ => "#ffffff".to_owned(),
    }
}

#[cfg(windows)]
fn detect_taskbar(mon_x: f64, mon_y: f64, mon_w: f64, mon_h: f64) -> (String, f64, f64) {
    use windows::Win32::UI::Shell::{SHAppBarMessage, ABM_GETTASKBARPOS, APPBARDATA};
    let mut abd = APPBARDATA {
        cbSize: std::mem::size_of::<APPBARDATA>() as u32,
        ..Default::default()
    };
    let ok = unsafe { SHAppBarMessage(ABM_GETTASKBARPOS, &mut abd) };
    if ok != 0 {
        let edge = match abd.uEdge {
            0 => "left",
            1 => "top",
            2 => "right",
            _ => "bottom",
        };
        let tx = ((abd.rc.left + abd.rc.right) as f64) * 0.5 - mon_x;
        let ty = ((abd.rc.top + abd.rc.bottom) as f64) * 0.5 - mon_y;
        return (edge.to_owned(), tx.clamp(0.0, mon_w), ty.clamp(0.0, mon_h));
    }
    ("bottom".to_owned(), mon_w * 0.5, mon_h - 24.0)
}

#[cfg(not(windows))]
fn detect_taskbar(_mon_x: f64, _mon_y: f64, mon_w: f64, mon_h: f64) -> (String, f64, f64) {
    ("bottom".to_owned(), mon_w * 0.5, mon_h - 24.0)
}

fn prepare_fx_overlay(app: &AppHandle, kind: &str) -> Option<(FxPayload, tauri::WebviewWindow)> {
    let main = app.get_webview_window(MAIN_LABEL)?;
    let fx = app.get_webview_window(FX_LABEL)?;
    let mon = main
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| main.primary_monitor().ok().flatten())?;

    let scale = mon.scale_factor();
    let mon_pos = mon.position();
    let mon_size = mon.size();
    let mon_x = mon_pos.x as f64;
    let mon_y = mon_pos.y as f64;
    let mon_w_phys = mon_size.width as f64;
    let mon_h_phys = mon_size.height as f64;
    let mon_w = mon_w_phys / scale;
    let mon_h = mon_h_phys / scale;

    let (wx, wy, ww, wh) = match (main.outer_position(), main.outer_size()) {
        (Ok(p), Ok(s)) if p.x > -10000 && p.y > -10000 && s.width > 100 && s.height > 100 => (
            (p.x as f64 - mon_x) / scale,
            (p.y as f64 - mon_y) / scale,
            (s.width as f64) / scale,
            (s.height as f64) / scale,
        ),
        _ => {
            if let Some(r) = LAST_RECT.lock().ok().and_then(|g| g.clone()) {
                (r.x, r.y, r.w, r.h)
            } else {
                (mon_w * 0.15, mon_h * 0.12, mon_w * 0.7, mon_h * 0.76)
            }
        }
    };

    let (edge, tx_phys, ty_phys) = detect_taskbar(mon_x, mon_y, mon_w_phys, mon_h_phys);

    let _ = fx.set_position(PhysicalPosition::new(mon_pos.x, mon_pos.y));
    let _ = fx.set_size(PhysicalSize::new(mon_size.width, mon_size.height));
    let _ = fx.set_always_on_top(true);
    let _ = fx.set_ignore_cursor_events(true);
    let _ = fx.show();

    let payload = FxPayload {
        kind: kind.to_owned(),
        win_rect: FxRect {
            x: wx,
            y: wy,
            w: ww,
            h: wh,
        },
        mon_w,
        mon_h,
        target_x: tx_phys / scale,
        target_y: ty_phys / scale,
        edge,
        accent: current_accent(app),
    };
    Some((payload, fx))
}

fn dispatch_fx(fx: &tauri::WebviewWindow, payload: &FxPayload) {
    let _ = fx.emit_to(FX_LABEL, "fx-play", payload.clone());
    if let Ok(json) = serde_json::to_string(payload) {
        let _ = fx.eval(&format!("window.__arimaFxPlay && window.__arimaFxPlay({json})"));
    }
}

pub fn play_open(app: &AppHandle) {
    let Some((payload, fx)) = prepare_fx_overlay(app, "open") else {
        if let Some(w) = app.get_webview_window(MAIN_LABEL) {
            FX_INTERNAL.store(true, Ordering::Release);
            let _ = w.show();
            let _ = w.unminimize();
            let _ = w.set_focus();
            FX_INTERNAL.store(false, Ordering::Release);
        }
        return;
    };
    let app_h = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(40)).await;
        dispatch_fx(&fx, &payload);
        tokio::time::sleep(std::time::Duration::from_millis(410)).await;
        if let Some(w) = app_h.get_webview_window(MAIN_LABEL) {
            FX_INTERNAL.store(true, Ordering::Release);
            let _ = w.show();
            let _ = w.unminimize();
            let _ = w.set_focus();
            FX_INTERNAL.store(false, Ordering::Release);
        }
        tokio::time::sleep(std::time::Duration::from_millis(380)).await;
        if let Some(fx_w) = app_h.get_webview_window(FX_LABEL) {
            let _ = fx_w.hide();
        }
    });
}

pub fn play_open_burst(app: &AppHandle) {
    let Some((payload, fx)) = prepare_fx_overlay(app, "open") else {
        return;
    };
    let app_h = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        dispatch_fx(&fx, &payload);
        tokio::time::sleep(std::time::Duration::from_millis(760)).await;
        if let Some(fx_w) = app_h.get_webview_window(FX_LABEL) {
            let _ = fx_w.hide();
        }
    });
}

pub fn play_minimize_external(app: &AppHandle) {
    let Some((payload, fx)) = prepare_fx_overlay(app, "minimize") else {
        return;
    };
    let app_h = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        dispatch_fx(&fx, &payload);
        tokio::time::sleep(std::time::Duration::from_millis(860)).await;
        if let Some(fx_w) = app_h.get_webview_window(FX_LABEL) {
            let _ = fx_w.hide();
        }
    });
}

pub fn play_close(app: &AppHandle, exit_after: bool) {
    let Some((payload, fx)) = prepare_fx_overlay(app, "close") else {
        if let Some(w) = app.get_webview_window(MAIN_LABEL) {
            if exit_after {
                app.exit(0);
            } else {
                let _ = w.hide();
            }
        }
        return;
    };
    let app_h = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(35)).await;
        if let Some(w) = app_h.get_webview_window(MAIN_LABEL) {
            let _ = w.hide();
        }
        dispatch_fx(&fx, &payload);
        tokio::time::sleep(std::time::Duration::from_millis(860)).await;
        if let Some(fx_w) = app_h.get_webview_window(FX_LABEL) {
            let _ = fx_w.hide();
        }
        if exit_after {
            app_h.exit(0);
        }
    });
}

#[tauri::command]
pub async fn fx_minimize(app: AppHandle) -> Result<()> {
    if !is_enabled(&app) {
        if let Some(w) = app.get_webview_window(MAIN_LABEL) {
            let _ = w.minimize();
        }
        return Ok(());
    }
    if let Some((payload, fx)) = prepare_fx_overlay(&app, "minimize") {
        let app_h = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(35)).await;
            if let Some(w) = app_h.get_webview_window(MAIN_LABEL) {

                FX_INTERNAL.store(true, Ordering::Release);
                let _ = w.minimize();
                FX_INTERNAL.store(false, Ordering::Release);
            }
            dispatch_fx(&fx, &payload);
            tokio::time::sleep(std::time::Duration::from_millis(860)).await;
            if let Some(fx_w) = app_h.get_webview_window(FX_LABEL) {
                let _ = fx_w.hide();
            }
        });
    } else if let Some(w) = app.get_webview_window(MAIN_LABEL) {
        let _ = w.minimize();
    }
    Ok(())
}

#[tauri::command]
pub async fn fx_hide(app: AppHandle) -> Result<()> {
    if let Some(fx) = app.get_webview_window(FX_LABEL) {
        let _ = fx.hide();
    }
    crate::trim_memory();
    Ok(())
}
