import { invoke } from '@tauri-apps/api/core';
import type {
  ArimaErrorKind,
  HistoryEntry,
  Lyrics,
  Settings,
  TasteProfile,
  Track
} from '$lib/types';

export class ArimaError extends Error {
  constructor(
    public kind: ArimaErrorKind,
    message: string,
    public retryAfter?: number
  ) {
    super(message);
  }
}

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

type Handler = (args?: Record<string, unknown>) => unknown | Promise<unknown>;
let mockHandlers: Record<string, Handler> | null = null;

export function installMock(handlers: Record<string, Handler>): void {
  mockHandlers = handlers;
}

function normalize(e: unknown): ArimaError {
  if (e instanceof ArimaError) return e;
  if (e && typeof e === 'object' && 'kind' in e) {
    const o = e as { kind: ArimaErrorKind; message?: string; retryAfter?: number };
    return new ArimaError(o.kind, o.message ?? o.kind, o.retryAfter);
  }
  return new ArimaError('other', typeof e === 'string' ? e : (e as Error)?.message ?? 'Ошибка');
}

export async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    if (mockHandlers) {
      const h = mockHandlers[cmd];
      if (!h) throw new ArimaError('other', `mock: ${cmd}`);
      return (await h(args)) as T;
    }
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw normalize(e);
  }
}

export interface ScRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  query?: Record<string, string>;
  body?: unknown;
}

export const ipc = {
  auth: {
    login: (token: string) => call<unknown>('auth_login', { token }),
    restore: () => call<unknown | null>('auth_restore'),
    logout: () => call<void>('auth_logout')
  },
  sc: {
    request: <T>(req: ScRequest) => call<T>('sc_request', { req: { method: 'GET', ...req } }),
    webSearch: <T>(q: string, kind: 'tracks' | 'users' | 'playlists' | 'albums') =>
      call<T>('sc_web_search', { q, kind }),
    resolveStream: (transcodingUrl: string, trackAuthorization?: string) =>
      call<string>('sc_resolve_stream', { transcodingUrl, trackAuthorization }),
    refreshClientId: () => call<string>('sc_refresh_client_id')
  },
  lyrics: {
    fetch: (trackId: number, title: string, artist: string, durationMs: number) =>
      call<Lyrics | null>('lyrics_fetch', { q: { trackId, title, artist, durationMs } })
  },
  metadata: {
    resolve: (title: string, artist: string) =>
      call<{ title: string; artist: string; source: string } | null>('metadata_resolve', { title, artist })
  },
  history: {
    log: (entry: {
      track: Track;
      listenedMs: number;
      durationMs: number;
      completed: boolean;
      skipped: boolean;
    }) => call<void>('history_log', { entry }),
    list: (limit: number, offset = 0) =>
      call<HistoryEntry[]>('history_list', { limit, offset }),
    clear: () => call<void>('history_clear'),
    taste: () => call<TasteProfile>('taste_profile')
  },
  settings: {
    get: () => call<Settings>('settings_get'),
    set: (patch: unknown) => call<Settings>('settings_set', { patch })
  },
  cache: {
    stats: () => call<{ bytes: number; files: number }>('cache_stats'),
    clear: () => call<void>('cache_clear')
  },
  app: {
    ready: () => call<void>('app_ready'),
    quit: () => call<void>('app_quit'),
    reset: () => call<void>('app_reset'),
    verifySc: (url?: string) => call<void>('sc_open_verify', { url }),
    likeViaWebview: (trackId: number, userId: number, liked: boolean) =>
      call<void>('sc_like_webview', { trackId, userId, liked }),
    minimizeFx: () => call<void>('fx_minimize'),
    hideFx: () => call<void>('fx_hide')
  },
  media: {
    update: (m: {
      title: string;
      artist: string;
      coverUrl?: string;
      durationMs: number;
      positionMs: number;
      playing: boolean;
    }) => call<void>('media_update', { m }),
    setPlayback: (playing: boolean, positionMs: number) =>
      call<void>('media_set_playback', { playing, positionMs })
  },
  discord: {
    update: (p: {
      title: string;
      artist: string;
      url: string;
      coverUrl?: string;
      durationMs: number;
      positionMs: number;
      playing: boolean;
    }) => call<void>('discord_update', { p }),
    clear: () => call<void>('discord_clear')
  },
  island: {
    setRect: (r: { x: number; y: number; w: number; h: number }) =>
      call<void>('island_set_rect', { r }),
    setPlaying: (playing: boolean, hasTrack: boolean) =>
      call<void>('island_set_playing', { playing, hasTrack }),
    notify: () => call<void>('island_notify'),
    toggleHidden: () => call<void>('island_toggle_hidden')
  }
};

export function userMessage(e: unknown): string {
  const err = normalize(e);
  switch (err.kind) {
    case 'unauthorized':
      return 'Токен недействителен или истёк. Войдите заново.';
    case 'forbidden':
      return 'Доступ запрещён SoundCloud.';
    case 'rateLimited':
      return `Слишком много запросов. Повторите через ${err.retryAfter ?? 30} с.`;
    case 'notFound':
      return 'Не найдено.';
    case 'network':
      return 'Нет соединения с SoundCloud.';
    default:
      return err.message || 'Ошибка.';
  }
}
