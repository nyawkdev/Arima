use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, LogicalPosition, Manager, PhysicalPosition, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::config::{ISLAND_HEIGHT, ISLAND_LABEL, ISLAND_WIDTH, MAIN_LABEL};
use crate::error::Result;
use crate::fullscreen;
use crate::settings::{IslandMode, IslandPosition, Settings};
use crate::AppState;

const TRANSIENT_DURATION: Duration = Duration::from_secs(5);
const HIT_PAD_PX: f64 = 14.0;

#[derive(Debug, Clone, Copy, Deserialize, Default)]
pub struct IslandRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, Serialize)]
struct HoverPayload {
    hover: bool,
}

#[derive(Debug, Clone, Serialize)]
struct HiddenPayload {
    hidden: bool,
}

struct Inner {
    playing: bool,
    has_track: bool,
    user_hidden: bool,
    transient_until: Option<Instant>,
    visible: bool,
    hover: bool,
    rect: IslandRect,
    registered_hotkey: Option<String>,
}

pub struct IslandManager {
    inner: Mutex<Inner>,
}

impl Default for IslandManager {
    fn default() -> Self {
        Self::new()
    }
}

impl IslandManager {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(Inner {
                playing: false,
                has_track: false,
                user_hidden: false,
                transient_until: None,
                visible: false,
                hover: false,
                rect: IslandRect::default(),
                registered_hotkey: None,
            }),
        }
    }
}

#[cfg(target_os = "windows")]
fn cursor_pos() -> Option<(i32, i32)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut pt = POINT::default();
    unsafe {
        if GetCursorPos(&mut pt).is_ok() {
            Some((pt.x, pt.y))
        } else {
            None
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn cursor_pos() -> Option<(i32, i32)> {
    None
}

fn place_window(app: &AppHandle, settings: &Settings) {
    let Some(win) = app.get_webview_window(ISLAND_LABEL) else {
        return;
    };
    let monitor = cursor_pos()
        .and_then(|(cx, cy)| win.monitor_from_point(f64::from(cx), f64::from(cy)).ok().flatten())
        .or_else(|| win.primary_monitor().ok().flatten());
    let Some(mon) = monitor else {
        return;
    };

    let scale = mon.scale_factor();
    let work = mon.work_area();
    let mon_x = f64::from(work.position.x) / scale;
    let mon_y = f64::from(work.position.y) / scale;
    let mon_w = f64::from(work.size.width) / scale;
    let mon_h = f64::from(work.size.height) / scale;
    let off = f64::from(settings.island.offset);

    let (x, y) = match settings.island.position {
        IslandPosition::TopCenter => (mon_x + (mon_w - ISLAND_WIDTH) / 2.0, mon_y + off),
        IslandPosition::TopLeft => (mon_x + off, mon_y + off),
        IslandPosition::TopRight => (mon_x + mon_w - ISLAND_WIDTH - off, mon_y + off),
        IslandPosition::BottomCenter => (
            mon_x + (mon_w - ISLAND_WIDTH) / 2.0,
            mon_y + mon_h - ISLAND_HEIGHT - off,
        ),
    };
    let _ = win.set_position(LogicalPosition::new(x, y));
}

fn main_is_away(app: &AppHandle) -> bool {
    let Some(main) = app.get_webview_window(MAIN_LABEL) else {
        return false;
    };
    let visible = main.is_visible().unwrap_or(false);
    if !visible {
        return true;
    }
    main.is_minimized().unwrap_or(false)
}

fn register_hotkey(app: &AppHandle, hotkey: &str) {
    let state = app.state::<AppState>();
    let prev = {
        let mut g = state.island.inner.lock().unwrap_or_else(|p| p.into_inner());
        g.registered_hotkey.take()
    };
    let gs = app.global_shortcut();
    if let Some(old) = prev {
        let _ = gs.unregister(old.as_str());
    }
    let clean = hotkey.trim();
    if clean.is_empty() {
        return;
    }
    let app_cb = app.clone();
    if gs
        .on_shortcut(clean, move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                toggle_hidden(&app_cb);
            }
        })
        .is_ok()
    {
        let mut g = state.island.inner.lock().unwrap_or_else(|p| p.into_inner());
        g.registered_hotkey = Some(clean.to_owned());
    }
}

fn toggle_hidden(app: &AppHandle) {
    let state = app.state::<AppState>();
    let hidden = {
        let mut g = state.island.inner.lock().unwrap_or_else(|p| p.into_inner());
        g.user_hidden = !g.user_hidden;
        g.user_hidden
    };
    let _ = app.emit("island-user-hidden", HiddenPayload { hidden });
}

pub fn setup(app: &AppHandle) {
    let settings = app.state::<AppState>().settings.get();
    register_hotkey(app, &settings.island.toggle_hotkey);

    let app_vis = app.clone();
    std::thread::Builder::new()
        .name("arima-island-vis".into())
        .spawn(move || loop {
            std::thread::sleep(Duration::from_millis(100));
            tick_visibility(&app_vis);
        })
        .ok();

    let app_hit = app.clone();
    std::thread::Builder::new()
        .name("arima-island-hit".into())
        .spawn(move || loop {
            let visible = {
                let st = app_hit.state::<AppState>();
                let g = st.island.inner.lock().unwrap_or_else(|p| p.into_inner());
                g.visible
            };
            if !visible {
                std::thread::sleep(Duration::from_millis(80));
                continue;
            }
            tick_cursor(&app_hit);
            std::thread::sleep(Duration::from_millis(16));
        })
        .ok();
}

fn tick_visibility(app: &AppHandle) {
    let state = app.state::<AppState>();
    let settings = state.settings.get();
    let now = Instant::now();

    let (playing, has_track, user_hidden, transient_active, was_visible, hover) = {
        let mut g = state.island.inner.lock().unwrap_or_else(|p| p.into_inner());
        if g.hover && g.transient_until.is_some() {
            g.transient_until = Some(now + TRANSIENT_DURATION);
        }
        let t_active = g.transient_until.is_some_and(|until| now < until);
        (
            g.playing,
            g.has_track,
            g.user_hidden,
            t_active,
            g.visible,
            g.hover,
        )
    };

    let mode_ok = match settings.island.mode {
        IslandMode::Off => false,
        IslandMode::Always => playing,
        IslandMode::Transient => transient_active,
    };

    let want = mode_ok
        && has_track
        && !user_hidden
        && main_is_away(app)
        && !(settings.island.hide_in_fullscreen && fullscreen::is_fullscreen_busy());

    if want == was_visible {
        return;
    }

    if let Some(win) = app.get_webview_window(ISLAND_LABEL) {
        if want {
            place_window(app, &settings);
            let _ = win.set_ignore_cursor_events(true);
            let _ = win.show();
            let _ = win.set_always_on_top(true);
        } else {
            let _ = win.hide();
            if hover {
                let _ = win.emit("island-hover", HoverPayload { hover: false });
            }
        }
    }

    let mut g = state.island.inner.lock().unwrap_or_else(|p| p.into_inner());
    g.visible = want;
    if !want {
        g.hover = false;
    }
}

fn tick_cursor(app: &AppHandle) {
    let Some(win) = app.get_webview_window(ISLAND_LABEL) else {
        return;
    };
    let Some((cx, cy)) = cursor_pos() else {
        return;
    };
    let Ok(PhysicalPosition { x: wx, y: wy }) = win.outer_position() else {
        return;
    };
    let scale = win.scale_factor().unwrap_or(1.0);

    let state = app.state::<AppState>();
    let (rect, prev_hover) = {
        let g = state.island.inner.lock().unwrap_or_else(|p| p.into_inner());
        (g.rect, g.hover)
    };

    let inside = if rect.w > 0.0 && rect.h > 0.0 {
        let rx = f64::from(wx) + (rect.x - HIT_PAD_PX) * scale;
        let ry = f64::from(wy) + (rect.y - HIT_PAD_PX) * scale;
        let rw = (rect.w + HIT_PAD_PX * 2.0) * scale;
        let rh = (rect.h + HIT_PAD_PX * 2.0) * scale;
        let fx = f64::from(cx);
        let fy = f64::from(cy);
        fx >= rx && fx <= rx + rw && fy >= ry && fy <= ry + rh
    } else {
        false
    };

    if inside != prev_hover {
        let _ = win.set_ignore_cursor_events(!inside);
        let _ = win.emit("island-hover", HoverPayload { hover: inside });
        let mut g = state.island.inner.lock().unwrap_or_else(|p| p.into_inner());
        g.hover = inside;
    }
}

pub fn on_settings_changed(app: &AppHandle, old: &Settings, new: &Settings) {
    if old.island.position != new.island.position || old.island.offset != new.island.offset {
        place_window(app, new);
    }
    if old.island.toggle_hotkey != new.island.toggle_hotkey {
        register_hotkey(app, &new.island.toggle_hotkey);
    }
}

#[tauri::command]
pub async fn island_set_rect(state: State<'_, AppState>, r: IslandRect) -> Result<()> {
    let mut g = state.island.inner.lock().unwrap_or_else(|p| p.into_inner());
    g.rect = r;
    Ok(())
}

#[tauri::command]
pub async fn island_set_playing(
    state: State<'_, AppState>,
    playing: bool,
    has_track: bool,
) -> Result<()> {
    let mut g = state.island.inner.lock().unwrap_or_else(|p| p.into_inner());
    g.playing = playing;
    g.has_track = has_track;
    Ok(())
}

#[tauri::command]
pub async fn island_notify(app: AppHandle, state: State<'_, AppState>) -> Result<()> {
    let changed = {
        let mut g = state.island.inner.lock().unwrap_or_else(|p| p.into_inner());
        let was_hidden = g.user_hidden;
        g.user_hidden = false;
        g.transient_until = Some(Instant::now() + TRANSIENT_DURATION);
        was_hidden
    };
    if changed {
        let _ = app.emit("island-user-hidden", HiddenPayload { hidden: false });
    }
    Ok(())
}

#[tauri::command]
pub async fn island_toggle_hidden(app: AppHandle) -> Result<()> {
    toggle_hidden(&app);
    Ok(())
}
