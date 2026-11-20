export interface ScUser {
  id: number;
  username: string;
  full_name?: string;
  avatar_url: string;
  permalink_url: string;
  followers_count?: number;
}

export interface Transcoding {
  url: string;
  preset: string;
  snipped?: boolean;
  format: { protocol: 'hls' | 'progressive'; mime_type: string };
}

export interface Track {
  id: number;
  kind?: string;
  title: string;
  duration: number;
  full_duration?: number;
  artwork_url: string | null;
  permalink_url: string;
  user: ScUser;
  genre?: string;
  tag_list?: string;
  streamable?: boolean;
  policy?: string;
  playback_count?: number;
  likes_count?: number;
  track_authorization?: string;
  media?: { transcodings: Transcoding[] };
  created_at?: string;
  publisher_metadata?: { artist?: string; album_title?: string };
  badge?: string;
}

export interface Playlist {
  id: number | string;
  title: string;
  description?: string | null;
  duration?: number;
  track_count: number;
  artwork_url: string | null;
  permalink_url?: string;
  user?: ScUser;
  sharing?: 'public' | 'private';
  tracks?: Track[];
  likes_count?: number;
  virtual?: boolean;
}

export interface Collection<T> {
  collection: T[];
  next_href: string | null;
}

export interface Page<T> {
  items: T[];
  next: string | null;
}

export interface LyricLine {
  t: number;
  text: string;
}

export interface Lyrics {
  source: string;
  synced: boolean;
  lines: LyricLine[];
  adapted?: string;
}

export type ArimaErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'rateLimited'
  | 'notFound'
  | 'network'
  | 'parse'
  | 'storage'
  | 'other';

export interface TasteProfile {
  genres: Record<string, number>;
  artists: Record<string, number>;
  tags: Record<string, number>;
  recentIds: number[];
  skippedIds: number[];
  totalPlays: number;
}

export interface HistoryEntry {
  track: Track;
  playedAt: number;
}

export type RepeatMode = 'off' | 'all' | 'one';
export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export interface Settings {
  closeToTray: boolean;
  autostart: boolean;
  startMinimized: boolean;
  proxy: string;
  cacheMaxMb: number;
  discordEnabled: boolean;
  discordAppId: string;
  island: {
    mode: 'always' | 'transient' | 'off';
    style: 'island' | 'pill' | 'mini';
    position: 'top-center' | 'top-left' | 'top-right' | 'bottom-center';
    offset: number;
    hideInFullscreen: boolean;
    toggleHotkey: string;
  };
  audio: {
    outputDeviceId: string;
    volume: number;
    preamp: number;
    eqPreset: string;
    eq: [number, number, number, number, number];
  };
  ui: {
    density: 'compact' | 'comfortable';
    visualizer: boolean;
    particleCount: number;
    lyricsSize: number;
    theme: 'dark' | 'light' | 'system';
    accentPreset: string;
    customAccent: string;
    customAccent2: string;
    customBg: string;
    customThemeName: string;
    hideDuplicates?: boolean;
    hideRemixes?: boolean;
    windowAnimations?: boolean;
    language?: 'en' | 'ru';
    onboardingDone?: boolean;
  };
}

export interface PlayerSnapshot {
  track: Pick<Track, 'id' | 'title' | 'duration' | 'artwork_url'> & { artist: string } | null;
  status: PlayerStatus;
  position: number;
  stamp: number;
  repeat: RepeatMode;
  shuffle: boolean;
  index: number;
  queue: { id: number; title: string; artist: string; artwork: string | null; duration: number }[];
}

export type PlayerCommand =
  | { cmd: 'toggle' }
  | { cmd: 'next' }
  | { cmd: 'prev' }
  | { cmd: 'seek'; value: number }
  | { cmd: 'repeat' }
  | { cmd: 'shuffle' }
  | { cmd: 'playIndex'; value: number }
  | { cmd: 'removeIndex'; value: number }
  | { cmd: 'showMain' };
