import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { get } from 'svelte/store';
import { ipc, isTauri } from '$lib/api/arima';
import { duration, player, playerActions, position, remixState, type PlayerState } from '$lib/stores/player';
import { settings } from '$lib/stores/settings';
import type { PlayerCommand, PlayerSnapshot } from '$lib/types';
import { artwork, debounce, normalizeTrack } from '$lib/utils';

function formatDiscordTitle(rawTitle: string, mode: string, bassBoost: number): string {
  const tags: string[] = [];
  if (mode === 'slowed') tags.push('Slowed');
  else if (mode === 'slowed-reverb') tags.push('Slowed + Reverb');
  else if (mode === 'speedup') tags.push('Speed Up');
  else if (mode === 'nightcore') tags.push('Nightcore');
  if (bassBoost >= 25) tags.push('Bass Boosted');
  return tags.length ? `${rawTitle} [${tags.join(' • ')}]` : rawTitle;
}

function snapshot(s: PlayerState): PlayerSnapshot {
  const c = s.current;
  return {
    track: c
      ? { id: c.id, title: c.title, duration: c.duration, artwork_url: c.artwork_url, artist: c.user?.username ?? '' }
      : null,
    status: s.status,
    position: get(position),
    stamp: Date.now(),
    repeat: s.repeat,
    shuffle: s.shuffle,
    index: s.index,
    queue: s.queue.slice(0, 120).map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.user?.username ?? '',
      artwork: t.artwork_url ?? t.user?.avatar_url ?? null,
      duration: t.duration
    }))
  };
}

async function handleCommand(c: PlayerCommand): Promise<void> {
  switch (c.cmd) {
    case 'toggle':
      return playerActions.toggle();
    case 'next':
      return playerActions.next();
    case 'prev':
      return playerActions.prev();
    case 'seek':
      return playerActions.seek(c.value);
    case 'repeat':
      return playerActions.cycleRepeat();
    case 'shuffle':
      return playerActions.toggleShuffle();
    case 'playIndex':
      return playerActions.playIndex(c.value);
    case 'removeIndex':
      return playerActions.removeAt(c.value);
    case 'showMain': {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const w = getCurrentWindow();
      await w.show();
      await w.unminimize();
      await w.setFocus();
    }
  }
}

export async function startSystemSync(): Promise<() => void> {
  if (!isTauri) return () => undefined;
  const unlisten: UnlistenFn[] = [];
  let lastTrackId = -1;
  let lastStatus = '';
  let lastPos = 0;
  let lastAt = performance.now();
  const geniusMetaCache = new Map<number, { title: string; artist: string }>();

  const pushIntegrations = debounce(() => {
    const s = get(player);
    const c = s.current;
    if (!c) {
      void ipc.discord.clear().catch(() => undefined);
      void ipc.island.setPlaying(false, false).catch(() => undefined);
      void ipc.media.setPlayback(false, 0).catch(() => undefined);
      return;
    }
    const posMs = Math.round(get(position) * 1000);
    const playing = s.status === 'playing';
    const durMs = Math.round((get(duration) || c.duration / 1000) * 1000);
    const rawArt = c.artwork_url || c.user?.avatar_url;
    const cover = rawArt ? artwork(rawArt, 't500x500') : undefined;
    const clean = normalizeTrack(c);
    const cachedMeta = geniusMetaCache.get(c.id);
    const resolvedTitle = cachedMeta?.title || clean.title;
    const resolvedArtist = cachedMeta?.artist || clean.user?.username || c.user?.username || 'SoundCloud';

    if (!cachedMeta) {
      void ipc.metadata
        .resolve(clean.title, clean.user?.username ?? '')
        .then((hit) => {
          if (hit && !geniusMetaCache.has(c.id)) {
            geniusMetaCache.set(c.id, { title: hit.title, artist: hit.artist });
            if (get(player).current?.id === c.id) pushIntegrations();
          }
        })
        .catch(() => undefined);
    }

    const rm = get(remixState);
    const discordTitle = formatDiscordTitle(resolvedTitle, rm.mode, rm.bassBoost);

    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: resolvedTitle,
          artist: resolvedArtist,
          album: 'Arima',
          artwork: cover ? [{ src: cover, sizes: '500x500', type: 'image/jpeg' }] : []
        });
        navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
        if (durMs > 0) {
          navigator.mediaSession.setPositionState({
            duration: durMs / 1000,
            playbackRate: 1,
            position: Math.min(durMs / 1000, Math.max(0, posMs / 1000))
          });
        }
      } catch {

      }
    }

    void ipc.media
      .update({ title: resolvedTitle, artist: resolvedArtist, coverUrl: cover, durationMs: durMs, positionMs: posMs, playing })
      .catch(() => undefined);
    void ipc.discord
      .update({
        title: discordTitle,
        artist: resolvedArtist,
        url: c.permalink_url,
        coverUrl: cover,
        durationMs: durMs,
        positionMs: posMs,
        playing
      })
      .catch(() => undefined);
    void ipc.island.setPlaying(playing || s.status === 'loading', true).catch(() => undefined);
  }, 150);

  const pushSnapshot = debounce(() => {
    void emit('player-sync', snapshot(get(player))).catch(() => undefined);
  }, 80);

  unlisten.push(
    player.subscribe((s) => {
      const id = s.current?.id ?? -1;
      const trackChanged = id !== lastTrackId;
      if (trackChanged && id !== -1) void ipc.island.notify().catch(() => undefined);
      if (trackChanged || s.status !== lastStatus) pushIntegrations();
      lastTrackId = id;
      lastStatus = s.status;
      pushSnapshot();
    })
  );

  unlisten.push(
    position.subscribe((p) => {
      const now = performance.now();
      const drift = Math.abs(p - lastPos - (now - lastAt) / 1000);
      if (get(player).status === 'playing' && drift > 1.5) {
        pushIntegrations();
        pushSnapshot();
      }
      lastPos = p;
      lastAt = now;
    })
  );

  unlisten.push(
    settings.subscribe(() => {
      pushIntegrations();
    })
  );

  unlisten.push(
    remixState.subscribe(() => {
      pushIntegrations();
    })
  );

  unlisten.push(
    await listen<{ action: string; positionMs?: number }>('media-key', (e) => {
      switch (e.payload.action) {
        case 'play':
          void playerActions.play();
          break;
        case 'pause':
        case 'stop':
          playerActions.pause();
          break;
        case 'toggle':
          void playerActions.toggle();
          break;
        case 'next':
          void playerActions.next();
          break;
        case 'prev':
          void playerActions.prev();
          break;
        case 'seek':
          if (e.payload.positionMs !== undefined) playerActions.seek(e.payload.positionMs / 1000);
          break;
      }
    })
  );

  unlisten.push(await listen<PlayerCommand>('player-cmd', (e) => void handleCommand(e.payload)));
  unlisten.push(await listen('island-ready', () => pushSnapshot()));
  return () => unlisten.forEach((u) => u());
}
