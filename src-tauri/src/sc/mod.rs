pub mod client;
pub mod client_id;

use std::collections::HashMap;

use serde::Deserialize;
use serde_json::Value;
use tauri::State;

use crate::error::Result;
use crate::AppState;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum ScMethod {

    Get,

    Post,

    Put,

    Delete,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScRequest {

    pub method: ScMethod,

    pub url: String,

    #[serde(default)]
    pub query: Option<HashMap<String, String>>,

    #[serde(default)]
    pub body: Option<Value>,
}

#[tauri::command]
pub async fn sc_request(state: State<'_, AppState>, req: ScRequest) -> Result<Value> {
    client::request(&state, &req).await
}

#[tauri::command]
pub async fn sc_resolve_stream(
    state: State<'_, AppState>,
    transcoding_url: String,
    track_authorization: Option<String>,
) -> Result<String> {
    client::resolve_stream(&state, &transcoding_url, track_authorization.as_deref()).await
}

#[tauri::command]
pub async fn sc_refresh_client_id(state: State<'_, AppState>) -> Result<String> {
    let http = state.http.get();
    match state.client_id.refresh(&http, true).await? {
        Some(id) => Ok(id),
        None => Ok(state.client_id.current()),
    }
}

#[tauri::command]
pub async fn sc_web_search(state: State<'_, AppState>, q: String, kind: String) -> Result<Value> {
    client::web_search(&state, &q, &kind).await
}
