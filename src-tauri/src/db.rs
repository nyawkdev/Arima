use std::path::Path;
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use crate::config::{LYRICS_NEGATIVE_TTL_MS, MIN_LISTEN_MS};
use crate::error::{AppError, Result};
use crate::lyrics::Lyrics;
use crate::taste::{self, PlayRecord, TasteProfile};
use crate::AppState;

pub struct Db {
    conn: Mutex<Connection>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub track: Value,
    pub played_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub track: Value,
    pub listened_ms: i64,
    pub duration_ms: i64,
    pub completed: bool,
    pub skipped: bool,
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

impl Db {

    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)
            .map_err(|e| AppError::storage(format!("SQLite open failed: {e}")))?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA cache_size = -1024;
             PRAGMA mmap_size = 0;
             PRAGMA foreign_keys = ON;
             CREATE TABLE IF NOT EXISTS tracks (
                 id          INTEGER PRIMARY KEY,
                 json        TEXT NOT NULL,
                 updated_at  INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS plays (
                 id          INTEGER PRIMARY KEY AUTOINCREMENT,
                 track_id    INTEGER NOT NULL,
                 played_at   INTEGER NOT NULL,
                 listened_ms INTEGER NOT NULL,
                 duration_ms INTEGER NOT NULL,
                 completed   INTEGER NOT NULL,
                 skipped     INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_plays_time ON plays(played_at DESC);
             CREATE INDEX IF NOT EXISTS idx_plays_track ON plays(track_id);
             CREATE TABLE IF NOT EXISTS lyrics (
                 track_id    INTEGER PRIMARY KEY,
                 json        TEXT,
                 fetched_at  INTEGER NOT NULL
             );",
        )
        .map_err(|e| AppError::storage(format!("SQLite migrate failed: {e}")))?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    fn lock(&self) -> MutexGuard<'_, Connection> {
        self.conn.lock().unwrap_or_else(|p| p.into_inner())
    }

    pub fn get_lyrics(&self, track_id: i64) -> Result<Option<Option<Lyrics>>> {
        let conn = self.lock();
        let row: Option<(Option<String>, i64)> = conn
            .query_row(
                "SELECT json, fetched_at FROM lyrics WHERE track_id = ?1",
                params![track_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| AppError::storage(format!("Lyrics cache read failed: {e}")))?;

        let Some((json_opt, fetched_at)) = row else {
            return Ok(None);
        };
        match json_opt {
            Some(s) => match serde_json::from_str::<Lyrics>(&s) {
                Ok(l) => Ok(Some(Some(l))),
                Err(_) => Ok(None),
            },
            None => {
                if now_ms() - fetched_at < LYRICS_NEGATIVE_TTL_MS {
                    Ok(Some(None))
                } else {
                    Ok(None)
                }
            }
        }
    }

    pub fn put_lyrics(&self, track_id: i64, lyrics: Option<&Lyrics>) -> Result<()> {
        let conn = self.lock();
        let json = match lyrics {
            Some(l) => Some(serde_json::to_string(l)?),
            None => None,
        };
        conn.execute(
            "INSERT INTO lyrics(track_id, json, fetched_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(track_id) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at",
            params![track_id, json, now_ms()],
        )
        .map_err(|e| AppError::storage(format!("Lyrics cache write failed: {e}")))?;
        Ok(())
    }

    pub fn log_play(&self, entry: &LogEntry) -> Result<()> {
        if entry.listened_ms < MIN_LISTEN_MS {
            return Ok(());
        }
        let track_id = entry
            .track
            .get("id")
            .and_then(|v| v.as_i64())
            .ok_or_else(|| AppError::parse("Track object missing numeric id"))?;
        let track_json = serde_json::to_string(&entry.track)?;
        let ts = now_ms();

        let conn = self.lock();
        conn.execute(
            "INSERT INTO tracks(id, json, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at",
            params![track_id, track_json, ts],
        )
        .map_err(|e| AppError::storage(format!("Track upsert failed: {e}")))?;

        conn.execute(
            "INSERT INTO plays(track_id, played_at, listened_ms, duration_ms, completed, skipped)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                track_id,
                ts,
                entry.listened_ms,
                entry.duration_ms,
                i32::from(entry.completed),
                i32::from(entry.skipped)
            ],
        )
        .map_err(|e| AppError::storage(format!("Play insert failed: {e}")))?;
        Ok(())
    }

    pub fn list_history(&self, limit: u32, offset: u32) -> Result<Vec<HistoryEntry>> {
        let conn = self.lock();
        let mut stmt = conn
            .prepare(
                "SELECT t.json, MAX(p.played_at) AS last_played
                 FROM plays p
                 JOIN tracks t ON t.id = p.track_id
                 GROUP BY p.track_id
                 ORDER BY last_played DESC
                 LIMIT ?1 OFFSET ?2",
            )
            .map_err(|e| AppError::storage(format!("History query failed: {e}")))?;

        let rows = stmt
            .query_map(params![i64::from(limit), i64::from(offset)], |r| {
                let raw: String = r.get(0)?;
                let played_at: i64 = r.get(1)?;
                Ok((raw, played_at))
            })
            .map_err(|e| AppError::storage(format!("History map failed: {e}")))?;

        let mut out = Vec::new();
        for row in rows {
            let (raw, played_at) =
                row.map_err(|e| AppError::storage(format!("History row failed: {e}")))?;
            if let Ok(track) = serde_json::from_str::<Value>(&raw) {
                out.push(HistoryEntry { track, played_at });
            }
        }
        Ok(out)
    }

    pub fn clear_history(&self) -> Result<()> {
        let conn = self.lock();
        conn.execute("DELETE FROM plays", [])
            .map_err(|e| AppError::storage(format!("History clear failed: {e}")))?;
        Ok(())
    }

    pub fn reset(&self) -> Result<()> {
        let conn = self.lock();
        conn.execute_batch("DELETE FROM plays; DELETE FROM tracks; DELETE FROM lyrics; VACUUM;")
            .map_err(|e| AppError::storage(format!("DB reset failed: {e}")))?;
        Ok(())
    }

    pub fn compute_taste(&self) -> Result<TasteProfile> {
        let conn = self.lock();
        let mut stmt = conn
            .prepare(
                "SELECT p.track_id, p.played_at, p.listened_ms, p.duration_ms,
                        p.completed, p.skipped, t.json
                 FROM plays p
                 JOIN tracks t ON t.id = p.track_id
                 ORDER BY p.played_at DESC
                 LIMIT 2000",
            )
            .map_err(|e| AppError::storage(format!("Taste query failed: {e}")))?;

        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, i32>(4)? != 0,
                    r.get::<_, i32>(5)? != 0,
                    r.get::<_, String>(6)?,
                ))
            })
            .map_err(|e| AppError::storage(format!("Taste map failed: {e}")))?;

        let mut records = Vec::new();
        for row in rows {
            let (track_id, played_at, listened_ms, duration_ms, completed, skipped, raw) =
                row.map_err(|e| AppError::storage(format!("Taste row failed: {e}")))?;
            let Ok(v) = serde_json::from_str::<Value>(&raw) else {
                continue;
            };
            let genre = v
                .get("genre")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_owned();
            let artist_id = v
                .get("user")
                .and_then(|u| u.get("id"))
                .and_then(|x| x.as_i64())
                .map(|id| id.to_string())
                .unwrap_or_default();
            let tag_list = v
                .get("tag_list")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_owned();
            records.push(PlayRecord {
                track_id,
                played_at,
                listened_ms,
                duration_ms,
                completed,
                skipped,
                genre,
                artist_id,
                tag_list,
            });
        }
        Ok(taste::build_profile(&records, now_ms()))
    }
}

#[tauri::command]
pub async fn history_log(state: State<'_, AppState>, entry: LogEntry) -> Result<()> {
    state.db.log_play(&entry)
}

#[tauri::command]
pub async fn history_list(
    state: State<'_, AppState>,
    limit: u32,
    offset: u32,
) -> Result<Vec<HistoryEntry>> {
    state.db.list_history(limit, offset)
}

#[tauri::command]
pub async fn history_clear(state: State<'_, AppState>) -> Result<()> {
    state.db.clear_history()
}

#[tauri::command]
pub async fn taste_profile(state: State<'_, AppState>) -> Result<TasteProfile> {
    state.db.compute_taste()
}
