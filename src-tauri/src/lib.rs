pub mod auth;
pub mod config;
pub mod db;
pub mod discord;
pub mod error;
pub mod fullscreen;
pub mod fx;
pub mod island;
pub mod lyrics;
pub mod media;
pub mod sc;
pub mod settings;
pub mod stream_proxy;
pub mod taste;
pub mod tray;

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

use auth::AuthStore;
use config::{MAIN_LABEL, STREAM_SCHEME};
use db::Db;
use discord::DiscordHandle;
use error::Result;
use island::IslandManager;
use media::MediaHandle;
use sc::client::HttpClient;
use sc::client_id::ClientIdStore;
use settings::SettingsStore;
use stream_proxy::StreamCache;

pub struct AppState {
    pub http: HttpClient,
    pub client_id: ClientIdStore,
    pub token: AuthStore,
    pub settings: SettingsStore,
    pub db: Db,
    pub cache: StreamCache,
    pub media: MediaHandle,
    pub discord: DiscordHandle,
    pub island: IslandManager,
    pub start_minimized: AtomicBool,
}

mod lifecycle {
    use super::*;

    #[tauri::command]
    pub async fn app_ready(app: AppHandle, state: State<'_, AppState>) -> Result<()> {
        let min = state.start_minimized.swap(false, Ordering::AcqRel);
        if !min {
            if fx::is_enabled(&app) {
                fx::play_open(&app);
            } else if let Some(win) = app.get_webview_window(MAIN_LABEL) {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }
        Ok(())
    }

    #[tauri::command]
    pub async fn app_quit(app: AppHandle) -> Result<()> {
        app.exit(0);
        Ok(())
    }

    #[tauri::command]
    pub async fn app_reset(app: AppHandle, state: State<'_, AppState>) -> Result<()> {
        state.token.set(None)?;
        state.cache.clear()?;
        state.db.reset()?;
        if let Ok(app_data) = app.path().app_data_dir() {
            let _ = std::fs::remove_file(app_data.join("client_id.txt"));
        }
        let (old, new) = state.settings.reset()?;
        if old.proxy != new.proxy {
            let _ = state.http.rebuild(&new.proxy);
        }
        settings::apply_side_effects(&app, &old, &new);
        if let Some(win) = app.get_webview_window(MAIN_LABEL) {
            let _ = win.clear_all_browsing_data();
        }
        let _ = app.emit("settings-changed", &new);
        Ok(())
    }
}

#[cfg(target_os = "windows")]
pub fn trim_memory() {
    use windows::Win32::System::Threading::{GetCurrentProcess, SetProcessWorkingSetSize};
    unsafe {
        let _ = SetProcessWorkingSetSize(GetCurrentProcess(), usize::MAX, usize::MAX);
    }
}

#[cfg(not(target_os = "windows"))]
pub fn trim_memory() {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "windows")]
    unsafe {
        use windows::core::w;
        use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
        let _ = SetCurrentProcessExplicitAppUserModelID(w!("app.arima.desktop"));
    }

    let minimized_arg = std::env::args().any(|a| a == "--minimized");

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::show_main(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .register_asynchronous_uri_scheme_protocol(STREAM_SCHEME, |ctx, req, responder| {
            stream_proxy::handle_protocol(ctx.app_handle().clone(), req, responder);
        })
        .setup(move |app| {
            let handle = app.handle();
            let app_data = handle.path().app_data_dir()?;
            let app_cfg = handle.path().app_config_dir()?;
            let app_cache = handle.path().app_cache_dir()?;

            let settings_store = SettingsStore::load(app_cfg.join("settings.json"));
            let initial_settings = settings_store.get();
            let http = HttpClient::new(&initial_settings.proxy)?;
            let client_id = ClientIdStore::load(app_data.join("client_id.txt"));
            let auth_store = AuthStore::load();
            let database = Db::open(&app_data.join("arima.db"))?;
            let cache = StreamCache::new(app_cache.join("stream"));
            cache.schedule_trim(handle);

            let media_handle = MediaHandle::start(handle.clone());
            let discord_handle = DiscordHandle::start(
                initial_settings.discord_enabled,
                initial_settings.discord_app_id.clone(),
            );

            let start_min = minimized_arg || initial_settings.start_minimized;

            app.manage(AppState {
                http,
                client_id,
                token: auth_store,
                settings: settings_store,
                db: database,
                cache,
                media: media_handle,
                discord: discord_handle,
                island: IslandManager::new(),
                start_minimized: AtomicBool::new(start_min),
            });

            tray::setup(handle)?;
            island::setup(handle);
            settings::sync_autostart(handle, initial_settings.autostart);

            if let Some(icon) = handle.default_window_icon().cloned() {
                for label in [MAIN_LABEL, "island", "fx"] {
                    if let Some(w) = handle.get_webview_window(label) {
                        let _ = w.set_icon(icon.clone());
                    }
                }
            }

            if let Some(main_win) = handle.get_webview_window(MAIN_LABEL) {
                let app_close = handle.clone();
                let was_minimized = AtomicBool::new(false);
                main_win.on_window_event(move |event| match event {
                    WindowEvent::CloseRequested { api, .. } => {
                        let st = app_close.state::<AppState>();
                        let close_to_tray = st.settings.get().close_to_tray;
                        if close_to_tray {
                            api.prevent_close();
                            if fx::is_enabled(&app_close) {
                                fx::play_close(&app_close, false);
                            } else if let Some(w) = app_close.get_webview_window(MAIN_LABEL) {
                                let _ = w.hide();
                                trim_memory();
                            }
                        } else if fx::is_enabled(&app_close) {
                            api.prevent_close();
                            fx::play_close(&app_close, true);
                        }
                    }
                    WindowEvent::Resized(_) | WindowEvent::Moved(_) => {
                        if let Some(w) = app_close.get_webview_window(MAIN_LABEL) {
                            let is_min = w.is_minimized().unwrap_or(false);
                            if !is_min {
                                fx::record_main_rect(&app_close);
                            }
                            let prev = was_minimized.swap(is_min, Ordering::AcqRel);
                            if !prev && is_min {
                                trim_memory();
                            }
                            if !fx::is_internal() && fx::is_enabled(&app_close) {
                                if !prev && is_min {
                                    fx::play_minimize_external(&app_close);
                                } else if prev && !is_min {
                                    fx::play_open_burst(&app_close);
                                }
                            }
                        }
                    }
                    _ => {}
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            lifecycle::app_ready,
            lifecycle::app_quit,
            lifecycle::app_reset,
            auth::auth_login,
            auth::auth_restore,
            auth::auth_logout,
            auth::sc_open_verify,
            auth::sc_like_webview,
            fx::fx_minimize,
            fx::fx_hide,
            sc::sc_request,
            sc::sc_web_search,
            sc::sc_resolve_stream,
            sc::sc_refresh_client_id,
            stream_proxy::cache_stats,
            stream_proxy::cache_clear,
            lyrics::lyrics_fetch,
            lyrics::metadata_resolve,
            db::history_log,
            db::history_list,
            db::history_clear,
            db::taste_profile,
            settings::settings_get,
            settings::settings_set,
            media::media_update,
            media::media_set_playback,
            discord::discord_update,
            discord::discord_clear,
            island::island_set_rect,
            island::island_set_playing,
            island::island_notify,
            island::island_toggle_hidden,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Arima");
}
