import { get, writable } from 'svelte/store';
import { ipc } from '$lib/api/arima';
import { sc } from '$lib/api/soundcloud';
import {
  computeWordCumulativeWeights,
  loadSavedLinePatches,
  saveLinePatches,
  type AlignedLineSegment
} from '$lib/audio/ai_sync';
import { likedTracks } from '$lib/stores/library';
import { player } from '$lib/stores/player';
import type { Lyrics, Track } from '$lib/types';
import { clamp, normalizeTrack } from '$lib/utils';

const BRAIN_STORAGE_KEY = 'arima:ai-brain:v2';

export interface AiBrainModel {
  version: number;
  epochs: number;
  trainedTrackIds: number[];
  calibratedLyricIds: number[];

  tokenWeights: Record<string, number>;

  artistWeights: Record<string, number>;

  genreIntroBiasMs: Record<string, number>;

  avgSyncConfidence: number;
  syncSamples: number;
  lastTrainedAt: number;
}

export interface AiTrainerStatus {
  running: boolean;
  turbo: boolean;
  phase: string;
  epochs: number;
  trainedTracks: number;
  calibratedLyrics: number;
  synapses: number;
  syncAccuracy: number;
}

const defaultBrain = (): AiBrainModel => ({
  version: 2,
  epochs: 0,
  trainedTrackIds: [],
  calibratedLyricIds: [],
  tokenWeights: {},
  artistWeights: {},
  genreIntroBiasMs: {},
  avgSyncConfidence: 0.86,
  syncSamples: 1,
  lastTrainedAt: 0
});

let brain: AiBrainModel = loadBrain();

function loadBrain(): AiBrainModel {
  if (typeof localStorage === 'undefined') return defaultBrain();
  try {
    const raw = localStorage.getItem(BRAIN_STORAGE_KEY);
    if (!raw) return defaultBrain();
    const parsed = JSON.parse(raw) as Partial<AiBrainModel>;
    return {
      ...defaultBrain(),
      ...parsed,
      tokenWeights: parsed.tokenWeights ?? {},
      artistWeights: parsed.artistWeights ?? {},
      genreIntroBiasMs: parsed.genreIntroBiasMs ?? {},
      trainedTrackIds: parsed.trainedTrackIds ?? [],
      calibratedLyricIds: parsed.calibratedLyricIds ?? []
    };
  } catch {
    return defaultBrain();
  }
}

function saveBrain(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (brain.trainedTrackIds.length > 800) {
      brain.trainedTrackIds = brain.trainedTrackIds.slice(-800);
    }
    if (brain.calibratedLyricIds.length > 600) {
      brain.calibratedLyricIds = brain.calibratedLyricIds.slice(-600);
    }
    localStorage.setItem(BRAIN_STORAGE_KEY, JSON.stringify(brain));
  } catch {

  }
}

function computeStatus(running: boolean, turbo: boolean, phase: string): AiTrainerStatus {
  const synapses =
    Object.keys(brain.tokenWeights).length +
    Object.keys(brain.artistWeights).length +
    Object.keys(brain.genreIntroBiasMs).length;
  return {
    running,
    turbo,
    phase,
    epochs: brain.epochs,
    trainedTracks: brain.trainedTrackIds.length,
    calibratedLyrics: brain.calibratedLyricIds.length,
    synapses,
    syncAccuracy: Math.round(clamp(brain.avgSyncConfidence * 100, 68, 99))
  };
}

export const aiTrainerStatus = writable<AiTrainerStatus>(
  computeStatus(false, false, 'Ожидание фонового цикла…')
);

function pushStatus(running: boolean, turbo: boolean, phase: string): void {
  aiTrainerStatus.set(computeStatus(running, turbo, phase));
}

function tokenizeTrack(t: Track): string[] {
  const clean = normalizeTrack(t);
  const raw = `${clean.title} ${clean.genre ?? ''} ${clean.tag_list ?? ''} ${clean.badge ?? ''}`
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ');
  return raw
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !/^(the|and|for|feat|prod|with|from|track|music)$/.test(w));
}

export function reinforceFromListen(track: Track, reward: number): void {
  const tokens = tokenizeTrack(track);
  const lr = 0.08;
  for (const tok of tokens) {
    const cur = brain.tokenWeights[tok] ?? 0;
    brain.tokenWeights[tok] = clamp(cur + lr * (reward - cur), -1, 1);
  }
  if (track.user?.id) {
    const aid = String(track.user.id);
    const curA = brain.artistWeights[aid] ?? 0;
    brain.artistWeights[aid] = clamp(curA + lr * 1.2 * (reward - curA), -1, 1);
  }
  if (!brain.trainedTrackIds.includes(track.id)) {
    brain.trainedTrackIds.push(track.id);
  }
  saveBrain();
  const s = get(aiTrainerStatus);
  pushStatus(s.running, s.turbo, s.phase);
}

export function recordSyncFeedback(track: Track | null, offsetMs: number, confidence: number): void {
  brain.syncSamples += 1;
  brain.avgSyncConfidence = brain.avgSyncConfidence * 0.92 + clamp(confidence, 0.5, 0.99) * 0.08;
  if (track && track.genre && Math.abs(offsetMs) <= 8000 && confidence >= 0.72) {
    const g = track.genre.trim().toLowerCase();
    const prev = brain.genreIntroBiasMs[g] ?? 0;
    brain.genreIntroBiasMs[g] = Math.round(prev * 0.8 + offsetMs * 0.2);
  }
  if (track && !brain.calibratedLyricIds.includes(track.id)) {
    brain.calibratedLyricIds.push(track.id);
  }
  saveBrain();
  const s = get(aiTrainerStatus);
  pushStatus(s.running, s.turbo, s.phase);
}

export function getGenreIntroPriorMs(track: Track | null): number {
  if (!track?.genre) return 0;
  return brain.genreIntroBiasMs[track.genre.trim().toLowerCase()] ?? 0;
}

export function getAiBrainScoreBonus(track: Track): number {
  const tokens = tokenizeTrack(track);
  let tokSum = 0;
  let tokHits = 0;
  for (const tok of tokens) {
    const w = brain.tokenWeights[tok];
    if (w !== undefined) {
      tokSum += w;
      tokHits++;
    }
  }
  const tokScore = tokHits > 0 ? tokSum / Math.sqrt(tokHits) : 0;
  const artScore = track.user?.id ? (brain.artistWeights[String(track.user.id)] ?? 0) : 0;
  return clamp(tokScore * 0.18 + artScore * 0.16, -0.25, 0.35);
}

function preCalibrateLyrics(track: Track, lrc: Lyrics): void {
  if (!lrc.synced || lrc.lines.length < 4) return;
  const existing = loadSavedLinePatches(track.id);
  if (existing) return;

  const trackDurMs = track.duration;
  const lastLineT = lrc.lines[lrc.lines.length - 1].t;
  let tempoFactor = 1.0;

  if (!lrc.adapted && trackDurMs > 45_000 && lastLineT > 35_000) {
    const expectedSpan = trackDurMs * 0.86;
    const ratio = lastLineT / expectedSpan;
    const lowerTitle = `${track.title} ${track.badge ?? ''}`.toLowerCase();
    if (/slowed|reverb/.test(lowerTitle) && ratio > 1.05 && ratio < 1.35) {
      tempoFactor = clamp(ratio, 1.05, 1.32);
    } else if (/speed\s*up|sped\s*up|nightcore/.test(lowerTitle) && ratio < 0.95 && ratio > 0.72) {
      tempoFactor = clamp(ratio, 0.75, 0.95);
    }
  }

  const segments: AlignedLineSegment[] = lrc.lines.map((l, i) => {
    const nextBase = lrc.lines[i + 1]?.t ?? l.t + 4200;
    const scaledStart = Math.round(l.t * tempoFactor);
    const scaledNext = Math.round(nextBase * tempoFactor);
    const gap = Math.max(450, scaledNext - scaledStart);
    const words = l.text.trim().split(/\s+/).filter(Boolean);
    const vowels = (l.text.match(/[аеёиоуыэюяaeiouy]/gi) ?? []).length;
    const phoneticMs = Math.max(480, Math.max(words.length, vowels) * 215 + words.length * 60 + 200);
    const singDur = clamp(
      gap > 3200 ? Math.min(gap - 650, phoneticMs * 1.25) : Math.min(gap * 0.84, phoneticMs * 1.15),
      360,
      Math.max(400, gap - 140)
    );
    const speed = clamp(phoneticMs / singDur, 0.6, 1.75);
    return {
      index: i,
      baseStartMs: l.t,
      startMs: scaledStart,
      singDurationMs: singDur,
      nextStartMs: scaledNext,
      lineSpeed: speed,
      wordCumulativeWeights: computeWordCumulativeWeights(l.text),
      voiceRole: 'lead',
      locked: Math.abs(scaledStart - l.t) >= 90 || Math.abs(speed - 1) >= 0.05
    };
  });

  saveLinePatches(track.id, segments);
  if (!brain.calibratedLyricIds.includes(track.id)) {
    brain.calibratedLyricIds.push(track.id);
  }
}

let loopTimer: ReturnType<typeof setTimeout> | undefined;
let busy = false;

export async function runTrainingEpoch(turbo = false): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    pushStatus(true, turbo, 'Анализ лайков и истории прослушиваний…');
    const likes = get(likedTracks).slice(0, turbo ? 120 : 40);
    const hist = await ipc.history.list(turbo ? 100 : 40).catch(() => []);
    const taste = await ipc.history.taste().catch(() => null);

    for (const t of likes) {
      reinforceFromListen(t, 0.85);
    }
    for (const h of hist) {
      if (!h.track?.id) continue;
      const skipped = taste?.skippedIds.includes(h.track.id) ?? false;
      reinforceFromListen(h.track, skipped ? -0.65 : 0.6);
    }

    const seedPool = [...likes.slice(0, 12), ...hist.slice(0, 12).map((h) => h.track)].filter(Boolean);
    if (seedPool.length > 0) {
      const seed = seedPool[brain.epochs % seedPool.length];
      if (seed?.id) {
        pushStatus(true, turbo, `Изучение графа похожих треков («${seed.title.slice(0, 24)}»)…`);
        const rel = await sc.related(seed.id, turbo ? 20 : 10).catch(() => [] as Track[]);
        for (const r of rel) {
          reinforceFromListen(r, 0.32);
        }
      }
    }

    const q = get(player).queue;
    const curIdx = Math.max(0, get(player).index);
    const upcoming = q.slice(curIdx, curIdx + (turbo ? 10 : 4));
    const toCalibrate = [...upcoming, ...likes.slice(0, turbo ? 12 : 4)].filter(
      (t) => t?.id && !brain.calibratedLyricIds.includes(t.id)
    );

    const batch = toCalibrate.slice(0, turbo ? 6 : 2);
    for (const t of batch) {
      const clean = normalizeTrack(t);
      pushStatus(true, turbo, `Калибровка текста и таймингов: «${clean.title.slice(0, 24)}»…`);
      const lrc = await ipc.lyrics
        .fetch(clean.id, clean.title, clean.user?.username ?? '', clean.duration)
        .catch(() => null);
      if (lrc) {
        preCalibrateLyrics(clean, lrc);
      } else if (!brain.calibratedLyricIds.includes(clean.id)) {
        brain.calibratedLyricIds.push(clean.id);
      }
    }

    brain.epochs += 1;
    brain.lastTrainedAt = Date.now();
    saveBrain();
    pushStatus(false, false, 'Фоновая модель активна и обучена');
  } finally {
    busy = false;
  }
}

export async function triggerTurboTraining(cycles = 3): Promise<void> {
  for (let i = 0; i < cycles; i++) {
    await runTrainingEpoch(true);
  }
}

export function startBackgroundAiTrainer(): () => void {
  clearTimeout(loopTimer);

  const scheduleNext = (delayMs: number) => {
    loopTimer = setTimeout(async () => {
      await runTrainingEpoch(false).catch(() => undefined);
      scheduleNext(45_000);
    }, delayMs);
  };

  scheduleNext(4000);

  return () => {
    clearTimeout(loopTimer);
  };
}
