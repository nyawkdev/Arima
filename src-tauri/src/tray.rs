use serde::Serialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

use crate::config::MAIN_LABEL;

#[derive(Clone, Serialize)]
struct MediaKey {
    action: &'static str,
}

pub fn show_main(app: &AppHandle) {
    if crate::fx::is_enabled(app) {
        crate::fx::play_open(app);
        return;
    }
    if let Some(win) = app.get_webview_window(MAIN_LABEL) {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Показать", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let toggle = MenuItem::with_id(app, "toggle", "Играть / Пауза", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", "Следующий", true, None::<&str>)?;
    let prev = MenuItem::with_id(app, "prev", "Предыдущий", true, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show, &sep1, &toggle, &next, &prev, &sep2, &quit])?;

    let mut builder = TrayIconBuilder::with_id("arima-tray")
        .menu(&menu)
        .tooltip("Arima")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main(app),
            "toggle" => {
                let _ = app.emit("media-key", MediaKey { action: "toggle" });
            }
            "next" => {
                let _ = app.emit("media-key", MediaKey { action: "next" });
            }
            "prev" => {
                let _ = app.emit("media-key", MediaKey { action: "prev" });
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}
