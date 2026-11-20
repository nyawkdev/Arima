use std::time::Duration;

pub const PLACEHOLDER_CLIENT_ID: &str = "REPLACE_WITH_SOUNDCLOUD_CLIENT_ID";

pub const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

pub const API_HOST: &str = "api-v2.soundcloud.com";

pub const API_BASE: &str = "https://api-v2.soundcloud.com";

pub const WEB_ORIGIN: &str = "https://soundcloud.com";

pub const KEYRING_SERVICE: &str = "arima";

pub const KEYRING_USER: &str = "soundcloud-oauth";

pub const STREAM_SCHEME: &str = "arima-stream";

pub const STREAM_ORIGIN: &str = "http://arima-stream.localhost";

pub const RANGE_CHUNK: u64 = 1024 * 1024;

pub const MAX_FULL_BODY: u64 = 16 * 1024 * 1024;

pub const MAX_MANIFEST_BYTES: usize = 4 * 1024 * 1024;

pub const CLIENT_ID_COOLDOWN: Duration = Duration::from_secs(30);

pub const MAX_RETRY_AFTER: Duration = Duration::from_secs(5);

pub const MAX_RATE_RETRIES: u32 = 2;

pub const LYRICS_TIMEOUT: Duration = Duration::from_secs(4);

pub const LYRICS_NEGATIVE_TTL_MS: i64 = 24 * 60 * 60 * 1000;

pub const MIN_LISTEN_MS: i64 = 5_000;

pub const ISLAND_WIDTH: f64 = 560.0;

pub const ISLAND_HEIGHT: f64 = 240.0;

pub const ISLAND_LABEL: &str = "island";

pub const MAIN_LABEL: &str = "main";
