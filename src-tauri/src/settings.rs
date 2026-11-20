use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt;

use crate::error::{AppError, Result};
use crate::{island, AppState};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IslandMode {

    Always,

    Transient,

    Off,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum IslandPosition {

    TopCenter,

    TopLeft,

    TopRight,

    BottomCenter,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IslandStyle {
    Island,
    Pill,
    Mini,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct IslandSettings {

    pub mode: IslandMode,

    pub style: IslandStyle,

    pub position: IslandPosition,

    pub offset: u32,

    pub hide_in_fullscreen: bool,

    pub toggle_hotkey: String,
}

impl Default for IslandSettings {
    fn default() -> Self {
        Self {
            mode: IslandMode::Always,
            style: IslandStyle::Island,
            position: IslandPosition::TopCenter,
            offset: 12,
            hide_in_fullscreen: true,
            toggle_hotkey: "Ctrl+Alt+I".to_owned(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {

    pub close_to_tray: bool,

    pub autostart: bool,

    pub start_minimized: bool,

    pub proxy: String,

    pub cache_max_mb: u32,

    pub discord_enabled: bool,

    pub discord_app_id: String,

    pub island: IslandSettings,

    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            close_to_tray: true,
            autostart: false,
            start_minimized: false,
            proxy: String::new(),
            cache_max_mb: 512,
            discord_enabled: true,
            discord_app_id: "1108081579965808701".to_owned(),
            island: IslandSettings::default(),
            extra: Map::new(),
        }
    }
}

pub fn deep_merge(base: &mut Value, patch: Value) {
    match (base, patch) {
        (Value::Object(base_map), Value::Object(patch_map)) => {
            for (key, value) in patch_map {
                match base_map.get_mut(&key) {
                    Some(existing) => deep_merge(existing, value),
                    None => {
                        base_map.insert(key, value);
                    }
                }
            }
        }
        (slot, value) => *slot = value,
    }
}

pub struct SettingsStore {
    path: PathBuf,
    inner: Mutex<Settings>,
}

impl SettingsStore {

    pub fn load(path: PathBuf) -> Self {
        let settings = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Settings>(&bytes).ok())
            .unwrap_or_default();
        Self {
            path,
            inner: Mutex::new(settings),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Settings> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn get(&self) -> Settings {
        self.lock().clone()
    }

    pub fn apply_patch(
        &self,
        patch: Value,
        validate: impl FnOnce(&Settings, &Settings) -> Result<()>,
    ) -> Result<(Settings, Settings)> {
        let mut guard = self.lock();
        let old = guard.clone();
        let mut merged = serde_json::to_value(&old)?;
        deep_merge(&mut merged, patch);
        let mut new: Settings = serde_json::from_value(merged)
            .map_err(|err| AppError::parse(format!("Некорректные настройки: {err}")))?;
        new.proxy = new.proxy.trim().to_owned();
        new.discord_app_id = new.discord_app_id.trim().to_owned();
        validate(&old, &new)?;
        persist(&self.path, &new)?;
        *guard = new.clone();
        Ok((old, new))
    }

    pub fn reset(&self) -> Result<(Settings, Settings)> {
        let mut guard = self.lock();
        let old = guard.clone();
        let new = Settings::default();
        if self.path.exists() {
            let _ = std::fs::remove_file(&self.path);
        }
        *guard = new.clone();
        Ok((old, new))
    }
}

fn persist(path: &std::path::Path, settings: &Settings) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(settings)?)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

pub fn apply_side_effects(app: &AppHandle, old: &Settings, new: &Settings) {
    if old.autostart != new.autostart {
        sync_autostart(app, new.autostart);
    }
    let state = app.state::<AppState>();
    state.discord.configure(new.discord_enabled, &new.discord_app_id);
    if old.cache_max_mb != new.cache_max_mb {
        state.cache.schedule_trim(app);
    }
    island::on_settings_changed(app, old, new);
}

pub fn sync_autostart(app: &AppHandle, enabled: bool) {
    let manager = app.autolaunch();
    let current = manager.is_enabled().unwrap_or(false);
    if current == enabled {
        return;
    }
    let result = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };
    if let Err(err) = result {
        log::warn!("autostart toggle failed: {err}");
    }
}

#[tauri::command]
pub async fn settings_get(state: State<'_, AppState>) -> Result<Settings> {
    Ok(state.settings.get())
}

#[tauri::command]
pub async fn settings_set(
    app: AppHandle,
    state: State<'_, AppState>,
    patch: Value,
) -> Result<Settings> {
    let (old, new) = state.settings.apply_patch(patch, |old, new| {
        if old.proxy != new.proxy {
            state.http.rebuild(&new.proxy)?;
        }
        Ok(())
    })?;
    apply_side_effects(&app, &old, &new);
    app.emit("settings-changed", &new)?;
    Ok(new)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn deep_merge_merges_nested_objects() {
        let mut base = json!({ "a": 1, "island": { "mode": "always", "offset": 12 } });
        deep_merge(&mut base, json!({ "island": { "offset": 30 }, "b": [1, 2] }));
        assert_eq!(base["a"], 1);
        assert_eq!(base["island"]["mode"], "always");
        assert_eq!(base["island"]["offset"], 30);
        assert_eq!(base["b"], json!([1, 2]));
    }

    #[test]
    fn deep_merge_replaces_non_objects() {
        let mut base = json!({ "list": [1, 2, 3], "x": { "y": 1 } });
        deep_merge(&mut base, json!({ "list": [9], "x": 5 }));
        assert_eq!(base, json!({ "list": [9], "x": 5 }));
    }

    #[test]
    fn extra_keys_survive_round_trip() {
        let raw = json!({ "closeToTray": false, "audio": { "volume": 0.5 }, "ui": { "density": "compact" } });
        let parsed: Settings = serde_json::from_value(raw).unwrap_or_default();
        assert!(!parsed.close_to_tray);
        assert_eq!(parsed.cache_max_mb, 512);
        let back = serde_json::to_value(&parsed).unwrap_or_default();
        assert_eq!(back["audio"]["volume"], 0.5);
        assert_eq!(back["ui"]["density"], "compact");
        assert_eq!(back["island"]["toggleHotkey"], "Ctrl+Alt+I");
    }

    #[test]
    fn invalid_island_mode_is_rejected() {
        let result = serde_json::from_value::<Settings>(json!({ "island": { "mode": "sometimes" } }));
        assert!(result.is_err());
    }
}
