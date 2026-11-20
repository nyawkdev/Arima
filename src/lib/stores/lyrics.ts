import { derived, get, writable } from 'svelte/store';
import { recordSyncFeedback } from '$lib/ai/trainer';
import { ipc } from '$lib/api/arima';
import { LyricAutoAligner, type AlignedLineSegment } from '$lib/audio/ai_sync';
import { activeStreamUrl, engine, player, position } from '$lib/stores/player';
import type { Lyrics } from '$lib/types';

export interface LyricsState {
  trackId: number | null;
  status: 'idle' | 'loading' | 'ready' | 'none';
  data: Lyrics | null;
}

export const lyrics = writable<LyricsState>({ trackId: null, status: 'idle', data: null });

export const karaokeOpen = writable(false);

export const lyricSegments = writable<AlignedLineSegment[]>([]);

export const lyricWordProgress = writable(0);
export const lyricAiNote = writable<string | null>(null);

const memo = new Map<number, Lyrics | null>();
const aligner = new LyricAutoAligner();
let alignedKey = '';
let prescannedId = -1;
const LEAD_SECONDS = 0.04;

async function tryPrescanCurrent(): Promise<void> {
  const s = get(activeStreamUrl);
  const l = get(lyrics);
  if (!s || s.protocol !== 'progressive' || s.trackId === prescannedId) return;
  if (!l.data?.synced || l.trackId !== s.trackId || l.data.lines.length < 3) return;
  prescannedId = s.trackId;
  try {
    const resp = await fetch(s.url);
    if (!resp.ok) return;
    const arr = await resp.arrayBuffer();
    if (get(player).current?.id !== s.trackId) return;
    const Ctx = window.AudioContext;
    const tmpCtx = new Ctx();
    const decoded = await tmpCtx.decodeAudioData(arr);
    void tmpCtx.close().catch(() => undefined);
    if (get(player).current?.id !== s.trackId) return;
    const obs = aligner.prescanAudioBuffer(decoded);
    if (obs) {
      lyricSegments.set([...obs.segments]);
      lyricAiNote.set(obs.note);
    }
  } catch {

  }
}

function syncAlignerForCurrent(): void {
  const l = get(lyrics);
  const track = get(player).current;
  if (!track || !l.data?.synced || l.data.lines.length === 0) {
    if (alignedKey) {
      alignedKey = '';
      lyricSegments.set([]);
      lyricWordProgress.set(0);
      lyricAiNote.set(null);
    }
    return;
  }
  const key = `${track.id}:${l.data.source}:${l.data.lines.length}`;
  if (key !== alignedKey) {
    alignedKey = key;
    const init = aligner.reset(track.id, l.data.lines);
    lyricSegments.set([...init.segments]);
    lyricWordProgress.set(0);
    lyricAiNote.set(init.note);
    void tryPrescanCurrent();
  }
}

export function nudgeLyricOffset(deltaMs: number): void {
  const obs = aligner.nudgeLocalAt(engine.currentTime, deltaMs);
  lyricSegments.set([...obs.segments]);
  lyricAiNote.set(obs.note);
}

export async function ensureLyrics(): Promise<void> {
  const track = get(player).current;
  if (!track) {
    lyrics.set({ trackId: null, status: 'idle', data: null });
    syncAlignerForCurrent();
    return;
  }
  if (get(lyrics).trackId === track.id && get(lyrics).status !== 'idle') return;
  if (memo.has(track.id)) {
    const d = memo.get(track.id) ?? null;
    lyrics.set({ trackId: track.id, status: d ? 'ready' : 'none', data: d });
    syncAlignerForCurrent();
    return;
  }
  lyrics.set({ trackId: track.id, status: 'loading', data: null });
  syncAlignerForCurrent();
  try {
    const d = await ipc.lyrics.fetch(track.id, track.title, track.user?.username ?? '', track.duration);
    if (memo.size >= 20) {
      const oldest = memo.keys().next().value;
      if (oldest !== undefined) memo.delete(oldest);
    }
    memo.set(track.id, d);
    if (get(player).current?.id === track.id) {
      lyrics.set({ trackId: track.id, status: d ? 'ready' : 'none', data: d });
      syncAlignerForCurrent();
    }
  } catch {
    if (get(player).current?.id === track.id) {
      lyrics.set({ trackId: track.id, status: 'none', data: null });
      syncAlignerForCurrent();
    }
  }
}

export const activeLine = derived([lyrics, position, lyricSegments], ([$l, $p, $segs]) => {
  const d = $l.data;
  if (!d || !d.synced) return -1;
  const ms = ($p + LEAD_SECONDS) * 1000;
  let lo = 0;
  let hi = d.lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const startMs = $segs[mid]?.startMs ?? d.lines[mid].t;
    if (startMs <= ms) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
});

let unsub: (() => void) | null = null;

export function initLyricsWatcher(): void {
  if (unsub) return;
  let lastId = -1;
  const specBuf = new Uint8Array(256);

  const a = player.subscribe((p) => {
    if (p.current?.id !== lastId) {
      lastId = p.current?.id ?? -1;
      if (p.current) void ensureLyrics();
      else syncAlignerForCurrent();
    }
  });

  const b = karaokeOpen.subscribe((open) => {
    if (open) void ensureLyrics();
  });

  const c = activeStreamUrl.subscribe(() => {
    void tryPrescanCurrent();
  });

  const timer = setInterval(() => {

    if (typeof document !== 'undefined' && document.hidden && !get(karaokeOpen)) {
      return;
    }
    const p = get(player);
    const l = get(lyrics);
    if (p.status !== 'playing' || !l.data?.synced) return;
    if (engine.readSpectrum(specBuf)) {
      const obs = aligner.observe(engine.currentTime, specBuf);
      if (obs) {
        if (obs.structureChanged) {
          lyricSegments.set([...obs.segments]);
          lyricAiNote.set(obs.note);
          if (obs.adjustedLinesCount > 0) {
            const activeSeg = obs.segments[obs.activeLineIndex];
            const localShift = activeSeg ? activeSeg.startMs - activeSeg.baseStartMs : 0;
            recordSyncFeedback(p.current, localShift, obs.confidence);
          }
        }
        lyricWordProgress.set(obs.lineWordProgress);
      }
    }
  }, 75);

  unsub = () => {
    a();
    b();
    c();
    clearInterval(timer);
    unsub = null;
  };
}
