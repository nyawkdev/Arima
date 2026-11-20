use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {

    Unauthorized,

    Forbidden,

    RateLimited,

    NotFound,

    Network,

    Parse,

    Storage,

    Other,
}

#[derive(Debug, Clone, Serialize, thiserror::Error)]
#[serde(rename_all = "camelCase")]
#[error("{message}")]
pub struct AppError {

    pub kind: ErrorKind,

    pub message: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after: Option<u64>,
}

pub type Result<T> = std::result::Result<T, AppError>;

impl AppError {
    fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            retry_after: None,
        }
    }

    pub fn unauthorized() -> Self {
        Self::new(ErrorKind::Unauthorized, "Требуется авторизация")
    }

    pub fn forbidden() -> Self {
        Self::new(ErrorKind::Forbidden, "Доступ запрещён")
    }

    pub fn captcha(url: impl AsRef<str>) -> Self {
        Self::new(ErrorKind::Forbidden, format!("captcha:{}", url.as_ref()))
    }

    pub fn rate_limited(retry_after: u64) -> Self {
        Self {
            retry_after: Some(retry_after),
            ..Self::new(
                ErrorKind::RateLimited,
                "Слишком много запросов, попробуйте позже",
            )
        }
    }

    pub fn not_found() -> Self {
        Self::new(ErrorKind::NotFound, "Не найдено")
    }

    pub fn network(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Network, message)
    }

    pub fn parse(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Parse, message)
    }

    pub fn storage(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Storage, message)
    }

    pub fn other(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Other, message)
    }
}

impl From<reqwest::Error> for AppError {
    fn from(err: reqwest::Error) -> Self {
        if err.is_decode() {
            Self::parse(err.to_string())
        } else {
            Self::network(err.without_url().to_string())
        }
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(err: rusqlite::Error) -> Self {
        Self::storage(err.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        Self::storage(err.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        Self::parse(err.to_string())
    }
}

impl From<keyring::Error> for AppError {
    fn from(err: keyring::Error) -> Self {
        Self::storage(err.to_string())
    }
}

impl From<tauri::Error> for AppError {
    fn from(err: tauri::Error) -> Self {
        Self::other(err.to_string())
    }
}

impl From<url::ParseError> for AppError {
    fn from(err: url::ParseError) -> Self {
        Self::other(format!("Некорректный URL: {err}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_camel_case_with_retry_after() {
        let json = serde_json::to_value(AppError::rate_limited(12)).unwrap_or_default();
        assert_eq!(json["kind"], "rateLimited");
        assert_eq!(json["retryAfter"], 12);
        let json = serde_json::to_value(AppError::not_found()).unwrap_or_default();
        assert_eq!(json["kind"], "notFound");
        assert!(json.get("retryAfter").is_none());
    }
}
