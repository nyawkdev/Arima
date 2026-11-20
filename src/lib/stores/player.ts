import { get, writable } from 'svelte/store';
import { ipc } from '$lib/api/arima';
import { sc } from '$lib/api/soundcloud';
import { AudioEngine, type EngineState, type RemixMode } from '$lib/audio/engine';
import { aiAdaptiveEq } from '$lib/audio/eq';
import { settings, updateSettings } from '$lib/stores/settings';
import type { PlayerStatus, RepeatMode, Track } from '$lib/types';
import { clamp, debounce, isPlayable, normalizeTrack, shuffled } from '$lib/utils';

export interface PlayerState {
  current: Track | null;
  queue: Track[];
  index: number;
  status: PlayerStatus;
  repeat: RepeatMode;
  shuffle: boolean;
  volume: number;
  muted: boolean;
  error: string | null;
}

export const player = writable<PlayerState>({
  current: null,
  queue: [],
  index: -1,
  status: 'idle',
  repeat: 'off',
  shuffle: false,
  volume: 0.8,
  muted: false,
  error: null
});

export const position = writable(0);
export const duration = writable(0);
export const activeAiEqLabel = writable('ИИ-EQ: Студийный баланс');
export const remixState = writable<{ mode: RemixMode; bassBoost: number }>({ mode: 'original', bassBoost: 0 });
export const activeStreamUrl = writable<{ trackId: number; url: string; protocol: string } | null>(null);

export function setLocalRemix(mode: RemixMode, bassBoost: number): void {
  const clampedBass = clamp(Math.round(bassBoost), 0, 100);
  remixState.set({ mode, bassBoost: clampedBass });
  engine.setRemix(mode, clampedBass);
}

function syncTrackAiEq(track: Track | null): void {
  const a = get(settings).audio;
  const isDefaultFlat = (a.eqPreset || 'flat') === 'flat' && (a.eq ?? [0, 0, 0, 0, 0]).every((v) => v === 0);
  if (isDefaultFlat) {
    const ai = aiAdaptiveEq(track);
    activeAiEqLabel.set(ai.label);
    engine.setEq(ai.gains, a.preamp ?? 0);
  } else {
    activeAiEqLabel.set('Ручной EQ');
    engine.setEq(a.eq ?? [0, 0, 0, 0, 0], a.preamp ?? 0);
  }
}

type Refill = () => Promise<Track[]>;

const REFILL_THRESHOLD = 5;
const SKIP_WINDOW_MS = 30_000;
const CROSSFADE_LEAD_SEC = 5.0;
const SESSION_KEY = 'arima:session:v1';

let originalQueue: Track[] | null = null;
let refill: Refill | null = null;
let activeRefillThreshold = REFILL_THRESHOLD;
let refillPromise: Promise<void> | null = null;
let loadSeq = 0;
let playedMs = 0;
let playingSince = 0;
let errorSkips = 0;
let crossfadingForId = -1;

function patch(p: Partial<PlayerState>): void {
  player.update((s) => ({ ...s, ...p }));
}

function setStatus(status: PlayerStatus): void {
  if (status === 'playing') {
    if (!playingSince) playingSince = performance.now();
  } else if (playingSince) {
    playedMs += performance.now() - playingSince;
    playingSince = 0;
  }
  patch({ status });
}

const onEngineState = (s: EngineState): void => {
  const map: Record<EngineState, PlayerStatus> = {
    idle: 'idle',
    loading: 'loading',
    buffering: 'loading',
    playing: 'playing',
    paused: 'paused'
  };
  const cur = get(player);
  if (cur.status === 'error' && s === 'idle') return;
  if (s === 'playing') errorSkips = 0;
  setStatus(map[s]);
};

export const engine = new AudioEngine({
  state: onEngineState,
  time: (t, d) => {
    position.set(t);
    if (d && Number.isFinite(d)) {
      duration.set(d);
      void maybeAutoMix(t, d);
    }
  },
  ended: () => void handleEnded(),
  error: (m) => void handleError(m)
});

async function maybeAutoMix(t: number, d: number): Promise<void> {
  const remaining = d - t;
  if (d < 35 || remaining > 11.5 || remaining < 0.8) return;
  const rms = engine.readRms();
  const isTrailingSilence = remaining <= 11.5 && remaining > 7.2 && t > 20 && rms > 0 && rms < 0.01;
  const isQuietOutro = remaining <= 7.2 && remaining > CROSSFADE_LEAD_SEC && rms > 0 && rms < 0.045;
  if (!isTrailingSilence && !isQuietOutro && remaining > CROSSFADE_LEAD_SEC) return;

  const s = get(player);
  if (s.status !== 'playing' || s.repeat === 'one' || !s.current) return;
  if (crossfadingForId === s.current.id) return;

  let nextIdx = s.index + 1;
  if (nextIdx >= s.queue.length) {
    if (s.repeat === 'all' && s.queue.length > 1) nextIdx = 0;
    else return;
  }
  const nextTrack = s.queue[nextIdx];
  if (!nextTrack || !isPlayable(nextTrack)) return;

  const fadeSec = isQuietOutro
    ? Math.max(3.2, Math.min(6.0, remaining - 0.3))
    : rms > 0.19
      ? 2.6
      : 4.2;

  crossfadingForId = s.current.id;
  const seq = ++loadSeq;
  try {
    const stream = await sc.resolveStream(nextTrack);
    if (seq !== loadSeq) return;
    activeStreamUrl.set({ trackId: nextTrack.id, url: stream.url, protocol: stream.protocol });
    finishCurrent('ended');
    patch({ current: nextTrack, index: nextIdx, error: null });
    syncTrackAiEq(nextTrack);
    position.set(0);
    duration.set(nextTrack.duration / 1000);
    void maybeRefill();
    saveSession();
    await engine.crossfadeTo(stream, fadeSec);
  } catch {

  }
}

function currentListenedMs(): number {
  return playedMs + (playingSince ? performance.now() - playingSince : 0);
}

function finishCurrent(reason: 'ended' | 'skip'): void {
  const { current } = get(player);
  if (!current) return;
  const listened = currentListenedMs();
  const dur = current.duration;
  const skipped = reason === 'skip' && listened < SKIP_WINDOW_MS;
  const completed = reason === 'ended' || listened >= dur * 0.9;
  if (listened >= 5000) {
    void ipc.history
      .log({
        track: current,
        listenedMs: Math.round(listened),
        durationMs: dur,
        completed,
        skipped
      })
      .catch(() => undefined);
  }
  if (skipped || completed) {
    void import('$lib/recommend/engine').then((m) => {
      const shouldPivot = m.recordSessionFeedback(current, skipped);
      if (refill && (shouldPivot || (skipped && activeRefillThreshold === 1))) {

        player.update((st) => ({
          ...st,
          queue: st.queue.slice(0, activeRefillThreshold === 1 ? st.index + 1 : st.index + 2)
        }));
        void maybeRefill();
      }
    });
  }
  playedMs = 0;
  playingSince = 0;
}

async function maybeRefill(force = false): Promise<void> {
  if (!refill) return;
  if (refillPromise) return refillPromise;
  const s = get(player);
  if (!force && s.queue.length - s.index > activeRefillThreshold) return;
  refillPromise = (async () => {
    try {
      const cur = get(player);
      const have = new Set(cur.queue.map((t) => t.id));
      const more = (await refill!()).filter((t) => !have.has(t.id));
      if (more.length) {
        originalQueue?.push(...more);
        player.update((st) => ({ ...st, queue: [...st.queue, ...more] }));
      }
    } catch {

    } finally {
      refillPromise = null;
    }
  })();
  return refillPromise;
}

async function startAt(index: number): Promise<void> {
  const s = get(player);
  const track = normalizeTrack(s.queue[index]);
  if (!track) return;
  const seq = ++loadSeq;
  crossfadingForId = -1;
  finishCurrent('skip');
  patch({ current: track, index, status: 'loading', error: null });
  syncTrackAiEq(track);
  position.set(0);
  duration.set(track.duration / 1000);
  saveSession();
  void maybeRefill();

  if (!isPlayable(track)) {
    patch({ error: 'Трек недоступен.' });
    if (seq === loadSeq) await advance(1, true);
    return;
  }
  try {
    const stream = await sc.resolveStream(track);
    if (seq !== loadSeq) return;
    activeStreamUrl.set({ trackId: track.id, url: stream.url, protocol: stream.protocol });
    await engine.load(stream);
  } catch (e) {
    if (seq !== loadSeq) return;
    await handleError(e instanceof Error ? e.message : 'Ошибка загрузки.');
  }
}

async function advance(dir: 1 | -1, auto = false): Promise<void> {
  const s = get(player);
  let next = s.index + dir;
  if (next >= s.queue.length) {
    if (refill && !auto) await maybeRefill(true);
    const fresh = get(player);
    if (next < fresh.queue.length) return startAt(next);
    if (s.repeat === 'all' && s.queue.length) next = 0;
    else {
      finishCurrent('ended');
      engine.pause();
      engine.seek(0);
      patch({ status: 'paused' });
      return;
    }
  } else if (next < 0) {
    next = s.repeat === 'all' ? s.queue.length - 1 : 0;
  }
  await startAt(next);
}

async function handleEnded(): Promise<void> {
  const s = get(player);
  if (s.repeat === 'one') {
    finishCurrent('ended');
    engine.seek(0);
    await engine.play();
    return;
  }
  finishCurrent('ended');
  await advance(1, true);
}

async function handleError(message: string): Promise<void> {
  errorSkips++;
  patch({ status: 'error', error: message });
  const s = get(player);
  if (errorSkips <= 3 && s.index < s.queue.length - 1) {
    setTimeout(() => {
      if (get(player).status === 'error') void advance(1, true);
    }, 1200);
  }
}

const persistVolume = debounce((v: number) => void updateSettings({ audio: { volume: v } }), 500);

export const playerActions = {

  async playQueue(
    tracks: Track[],
    startIndex = 0,
    refillFn: Refill | null = null,
    refillThreshold = REFILL_THRESHOLD
  ): Promise<void> {
    const list = tracks.filter(isPlayable);
    if (!list.length) return;
    const target = tracks[startIndex];
    const idx = Math.max(0, list.findIndex((t) => t.id === target?.id));
    refill = refillFn;
    activeRefillThreshold = refillThreshold;
    if (get(player).shuffle) {
      originalQueue = list.slice();
      const first = list[idx];
      const rest = shuffled(list.filter((t) => t.id !== first.id));
      patch({ queue: [first, ...rest] });
      await startAt(0);
    } else {
      originalQueue = null;
      patch({ queue: list });
      await startAt(idx);
    }
  },

  async playIndex(i: number): Promise<void> {
    await startAt(i);
  },

  async toggle(): Promise<void> {
    const s = get(player);
    if (!s.current) return;
    if (s.status === 'playing' || s.status === 'loading') engine.pause();
    else if (s.status === 'error' || !engine.hasSource) {
      await startAt(s.index);
    } else await engine.play();
  },

  play(): Promise<void> {
    return engine.play();
  },

  pause(): void {
    engine.pause();
  },

  async next(): Promise<void> {
    await advance(1);
  },

  async prev(): Promise<void> {
    if (get(position) > 3) {
      engine.seek(0);
      return;
    }
    await advance(-1);
  },

  seek(sec: number): void {
    const d = get(duration);
    engine.seek(clamp(sec, 0, d || sec));
    position.set(sec);
  },

  setVolume(v: number): void {
    const vol = clamp(v, 0, 1);
    patch({ volume: vol, muted: false });
    engine.setVolume(vol);
    persistVolume(vol);
  },

  toggleMute(): void {
    const s = get(player);
    patch({ muted: !s.muted });
    engine.setVolume(s.muted ? s.volume : 0);
  },

  toggleShuffle(): void {
    const s = get(player);
    if (!s.shuffle) {
      originalQueue = s.queue.slice();
      const cur = s.current;
      const rest = shuffled(s.queue.filter((t) => t.id !== cur?.id));
      patch({ shuffle: true, queue: cur ? [cur, ...rest] : rest, index: cur ? 0 : -1 });
    } else {
      const orig = originalQueue ?? s.queue;
      originalQueue = null;
      const idx = s.current ? orig.findIndex((t) => t.id === s.current!.id) : -1;
      patch({ shuffle: false, queue: orig, index: idx });
    }
  },

  cycleRepeat(): void {
    const order: RepeatMode[] = ['off', 'all', 'one'];
    const s = get(player);
    patch({ repeat: order[(order.indexOf(s.repeat) + 1) % order.length] });
  },

  enqueue(tracks: Track[]): void {
    const list = tracks.filter(isPlayable);
    if (!list.length) return;
    originalQueue?.push(...list);
    const s = get(player);
    if (!s.current) {
      void playerActions.playQueue(list);
      return;
    }
    patch({ queue: [...s.queue, ...list] });
  },

  playNext(track: Track): void {
    if (!isPlayable(track)) return;
    const s = get(player);
    if (!s.current) {
      void playerActions.playQueue([track]);
      return;
    }
    const q = s.queue.slice();
    q.splice(s.index + 1, 0, track);
    originalQueue?.push(track);
    patch({ queue: q });
  },

  removeAt(i: number): void {
    const s = get(player);
    if (i === s.index || i < 0 || i >= s.queue.length) return;
    const q = s.queue.slice();
    const [removed] = q.splice(i, 1);
    if (originalQueue) originalQueue = originalQueue.filter((t) => t.id !== removed.id);
    patch({ queue: q, index: i < s.index ? s.index - 1 : s.index });
  },

  clearUpcoming(): void {
    const s = get(player);
    if (s.index < 0) return;
    refill = null;
    patch({ queue: s.queue.slice(0, s.index + 1) });
    originalQueue = null;
  }
};

function saveSession(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const s = get(player);
    if (!s.current) return;
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        queue: s.queue.slice(0, 60),
        index: s.index,
        repeat: s.repeat,
        shuffle: s.shuffle
      })
    );
  } catch {

  }
}

export function restorePlayerSession(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as {
      queue?: Track[];
      index?: number;
      repeat?: RepeatMode;
      shuffle?: boolean;
    };
    const q = (saved.queue ?? []).filter(isPlayable);
    if (!q.length) return;
    const idx = clamp(saved.index ?? 0, 0, q.length - 1);
    const cur = q[idx];
    patch({
      queue: q,
      index: idx,
      current: cur,
      status: 'paused',
      repeat: saved.repeat ?? 'off',
      shuffle: !!saved.shuffle
    });
    duration.set(cur.duration / 1000);
  } catch {

  }
}

export function applyAudioSettings(): void {
  const a = get(settings).audio;
  patch({ volume: a.volume });
  engine.setVolume(a.volume);
  syncTrackAiEq(get(player).current);
  void engine.setOutputDevice(a.outputDeviceId);
}
