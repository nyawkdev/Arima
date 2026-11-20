import type { LyricLine } from '$lib/types';

export interface AlignedLineSegment {

  index: number;

  baseStartMs: number;

  startMs: number;

  singDurationMs: number;

  nextStartMs: number;

  lineSpeed: number;

  wordCumulativeWeights: number[];

  voiceRole: 'lead' | 'backing' | 'alt';

  contour?: number[];

  locked: boolean;
}

export interface SyncObservation {
  segments: AlignedLineSegment[];
  activeLineIndex: number;

  lineWordProgress: number;

  adjustedLinesCount: number;

  structureChanged?: boolean;
  note: string | null;
  confidence: number;
}

const STORAGE_PREFIX = 'arima:lyric-lines:v23:';
const BUCKET_MS = 10;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

const RU_VOWEL_RE = /[аеёиоуыэюя]/gi;
const EN_NUCLEI_RE = /[aeiouy]+/gi;

function countSyllables(word: string): number {
  const clean = word.toLowerCase().replace(/[^а-яёa-z]/gi, '');
  if (!clean) return 1;
  const ruCount = (clean.match(RU_VOWEL_RE) ?? []).length;
  if (ruCount > 0) return ruCount;

  const normEn = clean.replace(/^y(?=[aeiou])/, '').replace(/(?<=[^aeiouy])e$/, '');
  return Math.max(1, (normEn.match(EN_NUCLEI_RE) ?? []).length);
}

export function computeWordCumulativeWeights(text: string): number[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [1];

  const weights = words.map((w) => {
    const baseSyllables = countSyllables(w);
    let pauseBonus = 0;
    if (/[,;:]/.test(w)) pauseBonus += 0.45;
    if (/[.!?…]|—|-/.test(w)) pauseBonus += 0.75;
    const isAdlib = /^\(.*\)$/.test(w);
    const longVowelStretch = w.length >= 7 ? 0.35 : 0;
    const rawW = baseSyllables * 0.78 + Math.min(2.0, w.length * 0.11) + pauseBonus + longVowelStretch;
    return isAdlib ? rawW * 0.85 : rawW;
  });

  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  return weights.map((w) => {
    acc += w / total;
    return clamp(acc, 0, 1);
  });
}

function inferVoiceRole(text: string): 'lead' | 'backing' | 'alt' {
  const t = text.trim();
  if (/^\([^)]{2,36}\)$/.test(t) || /^(?:yeah|uh|ayy|skrrt|prr|оу|е+|ага)\b/i.test(t)) {
    return 'backing';
  }
  if (/^\[[^\]]+\]|^[А-ЯA-ZЁ][\w\s]{1,20}:/.test(t)) {
    return 'alt';
  }
  return 'lead';
}

function buildExpectedContour(text: string, weights: number[]): number[] {
  const trimmed = text.trim();
  if (!trimmed || /^\[[^\]]+\]$/.test(trimmed)) return new Array(16).fill(0.06);
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 0) return new Array(16).fill(0.06);

  const bins = new Array(16).fill(0.8);
  let prevW = 0;
  for (let wi = 0; wi < words.length; wi++) {
    const w = words[wi];
    const startBin = Math.floor(prevW * 16);
    const endBin = Math.min(15, Math.floor((weights[wi] ?? 1) * 16));
    const syl = countSyllables(w);
    const isAdlib = /^\(.*\)$/.test(w);
    const hasPause = /[,;:.!?…—-]$/.test(w);
    const energy = isAdlib ? 0.62 : syl >= 2 ? 0.92 : 0.78;
    for (let b = startBin; b <= endBin; b++) {
      bins[b] = b === startBin && wi === 0 ? Math.min(0.98, energy + 0.06) : energy;
    }
    if (hasPause && endBin < 15) {
      bins[endBin] = Math.min(bins[endBin], 0.42);
    }
    prevW = weights[wi] ?? 1;
  }
  return bins;
}

function estimateBaseSingDuration(text: string, gapToNextMs: number): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const syllables = words.reduce((acc, w) => acc + countSyllables(w), 0);
  const isBacking = inferVoiceRole(text) === 'backing';
  const phoneticMs = Math.max(460, syllables * (isBacking ? 165 : 185) + words.length * 50 + (isBacking ? 140 : 180));
  const maxSingWindow = gapToNextMs > 3200 ? Math.min(gapToNextMs - 650, phoneticMs * 1.32) : gapToNextMs * (isBacking ? 0.74 : 0.84);
  return clamp(Math.min(phoneticMs * (isBacking ? 0.96 : 1.15), maxSingWindow), 380, Math.max(420, gapToNextMs - 140));
}

interface SavedLinePatch {
  patches: Record<number, [number, number, number]>;
}

export function loadSavedLinePatches(trackId: number): SavedLinePatch | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${trackId}`);
    if (!raw) return null;
    return JSON.parse(raw) as SavedLinePatch;
  } catch {
    return null;
  }
}

export function saveLinePatches(trackId: number, segments: AlignedLineSegment[]): void {
  if (typeof localStorage === 'undefined' || !trackId) return;
  try {
    const patches: Record<number, [number, number, number]> = {};
    for (const s of segments) {
      const shift = Math.round(s.startMs - s.baseStartMs);
      if (s.locked || Math.abs(shift) >= 80 || Math.abs(s.lineSpeed - 1) >= 0.04) {
        patches[s.index] = [shift, Math.round(s.singDurationMs), Number(s.lineSpeed.toFixed(2))];
      }
    }
    localStorage.setItem(`${STORAGE_PREFIX}${trackId}`, JSON.stringify({ patches }));
  } catch {

  }
}

export class LyricAutoAligner {
  private trackId = 0;
  private segments: AlignedLineSegment[] = [];
  private adjustedCount = 0;
  private note: string | null = null;

  private vocalFloor = -1;
  private vocalPeak = -1;
  private prevCombined = 0;
  private prevNormEnergy = 0;
  private syllableActivity = 0;
  private smoothVocal = 0;
  private prevInstantVocal = 0;
  private pendingOnsetMs = -1;
  private pendingPhraseSnapMs = -1;
  private prevFramePosMs = -1;
  private inVocalPhrase = false;
  private silenceDurMs = 0;
  private vocalDurMs = 0;
  private lastPhraseOnsetMs = -10_000;
  private lastPosMs = -1;
  private lastSaveAt = 0;
  private lastClusterWarpPosMs = -10_000;
  private lastStructChangePosMs = -10_000;
  private globalCalibrated = false;
  private tempoCalibrated = false;
  private prescanned = false;

  private observed = new Map<number, number>();

  private curLineIdx = -1;
  private curLineProgress = 0;
  private curLineActiveVocalMs = 0;
  private curLineSilentTailMs = 0;

  reset(trackId: number, rawLines: LyricLine[]): SyncObservation {
    this.trackId = trackId;
    this.vocalFloor = -1;
    this.vocalPeak = -1;
    this.prevCombined = 0;
    this.prevNormEnergy = 0;
    this.syllableActivity = 0;
    this.smoothVocal = 0;
    this.prevInstantVocal = 0;
    this.pendingOnsetMs = -1;
    this.pendingPhraseSnapMs = -1;
    this.prevFramePosMs = -1;
    this.inVocalPhrase = false;
    this.silenceDurMs = 0;
    this.vocalDurMs = 0;
    this.lastPhraseOnsetMs = -10_000;
    this.lastPosMs = -1;
    this.lastClusterWarpPosMs = -10_000;
    this.lastStructChangePosMs = -10_000;
    this.globalCalibrated = false;
    this.tempoCalibrated = false;
    this.prescanned = false;
    this.observed.clear();
    this.curLineIdx = -1;
    this.curLineProgress = 0;
    this.curLineActiveVocalMs = 0;
    this.curLineSilentTailMs = 0;

    const saved = loadSavedLinePatches(trackId);
    let restoredCount = 0;

    this.segments = rawLines.map((l, i) => {
      const nextBase = rawLines[i + 1]?.t ?? l.t + 4200;
      const gap = Math.max(450, nextBase - l.t);
      const baseSing = estimateBaseSingDuration(l.text, gap);
      const patch = saved?.patches?.[i];
      const shift = patch ? clamp(patch[0], -12_000, 12_000) : 0;
      const singDur = patch ? clamp(patch[1], 320, gap * 1.25) : baseSing;
      const speed = patch ? clamp(patch[2], 0.55, 1.85) : 1.0;
      if (patch) restoredCount++;

      const weights = computeWordCumulativeWeights(l.text);
      return {
        index: i,
        baseStartMs: l.t,
        startMs: Math.max(0, l.t + shift),
        singDurationMs: singDur,
        nextStartMs: nextBase,
        lineSpeed: speed,
        wordCumulativeWeights: weights,
        voiceRole: inferVoiceRole(l.text),
        contour: buildExpectedContour(l.text, weights),
        locked: !!patch
      };
    });

    this.recomputeNextBounds();
    this.adjustedCount = restoredCount;
    this.note =
      restoredCount > 0
        ? `ИИ: построчный тайминг (${restoredCount} стр.)`
        : 'ИИ: построчная синхронизация и контроль пауз';

    return {
      segments: this.segments,
      activeLineIndex: -1,
      lineWordProgress: 0,
      adjustedLinesCount: this.adjustedCount,
      note: this.note,
      confidence: restoredCount > 0 ? 0.92 : 0.78
    };
  }

  prescanAudioBuffer(buf: AudioBuffer): SyncObservation | null {
    if (this.segments.length < 3 || buf.length < buf.sampleRate * 5) return null;
    const ch0 = buf.getChannelData(0);
    const sr = buf.sampleRate;
    const hop = Math.floor((sr * BUCKET_MS) / 1000);
    const numFrames = Math.floor(ch0.length / hop);
    if (numFrames < 40) return null;

    const energies = new Float32Array(numFrames);
    const zcrs = new Float32Array(numFrames);
    let minE = 1;
    let maxE = 0.01;

    const lpAlpha = clamp((2 * Math.PI * 2600) / sr, 0.05, 0.75);
    const hpAlpha = clamp(1 - (2 * Math.PI * 320) / sr, 0.75, 0.99);
    let lpState = 0;
    let hpState = 0;
    let prevIn = ch0[0] ?? 0;

    for (let f = 0; f < numFrames; f++) {
      const start = f * hop;
      const end = Math.min(ch0.length, start + hop);
      let sumSq = 0;
      let crossings = 0;
      let prev = ch0[start];
      for (let i = start + 1; i < end; i++) {
        const cur = ch0[i];
        hpState = hpAlpha * (hpState + cur - prevIn);
        prevIn = cur;
        lpState = lpState + lpAlpha * (hpState - lpState);
        sumSq += lpState * lpState;
        if ((cur >= 0 && prev < 0) || (cur < 0 && prev >= 0)) crossings++;
        prev = cur;
      }
      const rms = Math.sqrt(sumSq / Math.max(1, end - start));
      energies[f] = rms;
      zcrs[f] = crossings / Math.max(1, end - start);
      if (rms > 0.004 && rms < minE) minE = rms;
      if (rms > maxE) maxE = rms;
    }

    const sortedE = Float32Array.from(energies).sort();
    const adaptiveFloor = Math.max(minE, sortedE[Math.floor(sortedE.length * 0.2)] ?? minE);
    const span = Math.max(0.015, maxE - adaptiveFloor);
    const vocalEnv = new Float32Array(numFrames);
    for (let f = 0; f < numFrames; f++) {
      const normE = clamp((energies[f] - adaptiveFloor) / span, 0, 1);

      const zcrWeight = zcrs[f] > 0.34 ? 0.45 : zcrs[f] < 0.012 ? 0.55 : 1.0;
      vocalEnv[f] = clamp(normE * zcrWeight, 0, 1);
    }

    let adjusted = 0;
    let clusterStart = 0;
    while (clusterStart < this.segments.length) {
      let clusterEnd = clusterStart;
      while (clusterEnd + 1 < this.segments.length) {
        const gap =
          this.segments[clusterEnd + 1].baseStartMs -
          (this.segments[clusterEnd].baseStartMs + this.segments[clusterEnd].singDurationMs);
        if (gap > 3200) break;
        clusterEnd++;
      }

      let skipCluster = this.lastPosMs > 1500 && this.segments[clusterStart].startMs <= this.lastPosMs + 500;
      if (!skipCluster) {
        for (let i = clusterStart; i <= clusterEnd; i++) {
          if (this.segments[i].locked) {
            skipCluster = true;
            break;
          }
        }
      }
      if (skipCluster) {
        clusterStart = clusterEnd + 1;
        continue;
      }

      const evalShiftRate = (shift: number, rate: number): number => {
        let sum = 0;
        let cnt = 0;
        for (let i = clusterStart; i <= clusterEnd; i++) {
          const seg = this.segments[i];
          if (seg.locked) continue;
          const t0 = seg.baseStartMs * rate + shift;
          const t1 = t0 + seg.singDurationMs * rate;
          const f0Exact = clamp(t0 / BUCKET_MS, 0, numFrames - 1);
          const f0 = Math.floor(f0Exact);
          const f0Frac = f0Exact - f0;
          const f1 = clamp(Math.round(t1 / BUCKET_MS), f0 + 1, numFrames);
          let avgVocal = 0;
          for (let f = f0; f < f1; f++) avgVocal += vocalEnv[f];
          avgVocal /= Math.max(1, f1 - f0);
          let preSilenceBonus = 0;
          if (f0 >= 4) {
            const preAvg = (vocalEnv[f0 - 1] + vocalEnv[f0 - 2] + vocalEnv[f0 - 3]) / 3;
            const atOnset = vocalEnv[f0] * (1 - f0Frac) + vocalEnv[Math.min(numFrames - 1, f0 + 1)] * f0Frac;
            const postOnset = (atOnset + vocalEnv[Math.min(numFrames - 1, f0 + 1)] + vocalEnv[Math.min(numFrames - 1, f0 + 2)]) / 3;
            const w = i === clusterStart ? 0.65 : 0.4;
            preSilenceBonus = clamp(postOnset - preAvg, -0.4, 0.5) * w;
          }
          sum += avgVocal + preSilenceBonus;
          cnt++;
        }
        return (cnt > 0 ? sum / cnt : 0) - Math.abs(shift) * 0.000012 - Math.abs(rate - 1.0) * 0.05;
      };

      const score0 = evalShiftRate(0, 1.0);
      let bestShift = 0;
      let bestRate = 1.0;
      let bestScore = score0;
      for (let shift = -4000; shift <= 4000; shift += 150) {
        if (shift === 0) continue;
        const sc = evalShiftRate(shift, 1.0);
        if (sc > bestScore) {
          bestScore = sc;
          bestShift = shift;
        }
      }

      if (clusterEnd - clusterStart >= 3) {
        for (let r = 0.90; r <= 1.105; r += 0.02) {
          if (Math.abs(r - 1.0) < 0.015) continue;
          for (let shift = -1500; shift <= 1500; shift += 250) {
            const sc = evalShiftRate(shift, r);
            if (sc > bestScore) {
              bestScore = sc;
              bestShift = shift;
              bestRate = r;
            }
          }
        }
      }

      if (Math.abs(bestShift) >= 150 || Math.abs(bestRate - 1.0) >= 0.015) {
        const coarseS = bestShift;
        const coarseR = bestRate;
        for (let r = Math.max(0.89, coarseR - 0.015); r <= Math.min(1.11, coarseR + 0.015); r += 0.002) {
          if (Math.abs(coarseR - 1.0) < 0.015 && Math.abs(r - 1.0) > 0.001) continue;
          for (let shift = coarseS - 140; shift <= coarseS + 140; shift += 10) {
            const sc = evalShiftRate(shift, r);
            if (sc > bestScore) {
              bestScore = sc;
              bestShift = shift;
              bestRate = r;
            }
          }
        }
        const fS = bestShift;
        const fR = bestRate;
        for (let r = Math.max(0.89, fR - 0.004); r <= Math.min(1.11, fR + 0.004); r += 0.0005) {
          if (Math.abs(coarseR - 1.0) < 0.015 && Math.abs(r - 1.0) > 0.001) continue;
          for (let shift = fS - 14; shift <= fS + 14; shift += 2) {
            const sc = evalShiftRate(shift, r);
            if (sc > bestScore) {
              bestScore = sc;
              bestShift = shift;
              bestRate = r;
            }
          }
        }
      }

      if ((Math.abs(bestShift) >= 240 && bestScore - score0 >= 0.16) || (Math.abs(bestRate - 1.0) >= 0.02 && bestScore - score0 >= 0.05)) {
        for (let i = clusterStart; i <= clusterEnd; i++) {
          const seg = this.segments[i];
          if (seg.locked) continue;
          seg.startMs = Math.max(0, seg.baseStartMs * bestRate + bestShift);
          seg.singDurationMs = Math.max(380, seg.singDurationMs * bestRate);
          seg.lineSpeed = clamp(1 / bestRate, 0.72, 1.38);
          seg.locked = true;
          adjusted++;
        }
      }

      clusterStart = clusterEnd + 1;
    }

    if (adjusted > 0) {
      this.prescanned = true;
      this.globalCalibrated = true;
      this.tempoCalibrated = true;
      this.recomputeNextBounds();
      this.adjustedCount = this.segments.filter((s) => s.locked).length;
      this.note = `ИИ-прескан голоса: ${this.adjustedCount} стр. выровнено наперёд`;
      saveLinePatches(this.trackId, this.segments);
      return {
        segments: this.segments,
        activeLineIndex: -1,
        lineWordProgress: 0,
        adjustedLinesCount: this.adjustedCount,
        note: this.note,
        confidence: 0.94
      };
    }

    return null;
  }

  nudgeLocalAt(posSec: number, deltaMs: number): SyncObservation {
    const posMs = posSec * 1000;
    const centerIdx = Math.max(0, this.findActiveLine(posMs));
    this.applyElasticLineShift(centerIdx, deltaMs, 4, true);
    saveLinePatches(this.trackId, this.segments);
    return {
      segments: this.segments,
      activeLineIndex: centerIdx,
      lineWordProgress: this.curLineProgress,
      adjustedLinesCount: this.adjustedCount,
      note: `ИИ: локальная коррекция строки #${centerIdx + 1}`,
      confidence: 0.95
    };
  }

  observe(posSec: number, spectrum: Uint8Array<ArrayBuffer>): SyncObservation | null {
    if (this.segments.length < 2) return null;

    const posMs = posSec * 1000;
    if (this.lastPosMs >= 0 && Math.abs(posMs - this.lastPosMs) > 2200) {
      this.silenceDurMs = 0;
      this.vocalDurMs = 0;
      this.curLineProgress = 0;
      this.curLineActiveVocalMs = 0;
      this.curLineSilentTailMs = 0;
      this.lastPosMs = posMs;
    }
    const dtMs = this.lastPosMs >= 0 ? clamp(posMs - this.lastPosMs, 16, 200) : 75;
    this.lastPosMs = posMs;

    const len = spectrum.length;
    let bassSum = 0;
    for (let i = 0; i < Math.min(3, len); i++) bassSum += spectrum[i];
    const bassAvg = bassSum / 3;

    let coreSum = 0;
    let max1 = 0;
    let max2 = 0;
    let max3 = 0;
    for (let i = Math.min(4, len); i < Math.min(36, len); i++) {
      const v = spectrum[i];
      coreSum += v;
      if (v > max1) {
        max3 = max2;
        max2 = max1;
        max1 = v;
      } else if (v > max2) {
        max3 = max2;
        max2 = v;
      } else if (v > max3) {
        max3 = v;
      }
    }
    const vocalAvg = coreSum / 32;
    const peakAvg = (max1 + max2 + max3) / 3;

    const formantExcess = Math.max(0, peakAvg - vocalAvg * 1.06);
    const tonality = vocalAvg > 3 ? clamp((peakAvg / vocalAvg - 1.08) / 1.1, 0.05, 1.4) : 0.1;

    let contrastSum = 0;
    const cEnd = Math.min(35, len - 1);
    for (let i = 5; i < cEnd; i++) {
      const nb = (spectrum[i - 1] + spectrum[i + 1]) * 0.5;
      if (spectrum[i] > nb) contrastSum += spectrum[i] - nb;
    }
    const harmonicComb = vocalAvg > 3 ? clamp((contrastSum / Math.max(1, cEnd - 5)) / Math.max(4, vocalAvg * 0.34), 0.25, 1.3) : 0.3;

    let hatSum = 0;
    for (let i = Math.min(44, len); i < Math.min(92, len); i++) hatSum += spectrum[i];
    const hatAvg = hatSum / 48;

    const combined = (vocalAvg * tonality * 0.42 + formantExcess * 0.85) * (0.6 + 0.4 * harmonicComb);
    const flux = Math.max(0, combined - this.prevCombined);
    this.prevCombined = combined * 0.65 + this.prevCombined * 0.35;

    if (this.vocalFloor < 0) {
      this.vocalFloor = combined;
      this.vocalPeak = combined + 16;
    } else if (combined > 0.5) {
      if (combined < this.vocalFloor) {
        this.vocalFloor = this.vocalFloor * 0.8 + combined * 0.2;
      } else {
        this.vocalFloor = this.vocalFloor * 0.994 + combined * 0.006;
      }
      if (combined > this.vocalPeak) {
        if (hatAvg <= vocalAvg * 1.15) {
          this.vocalPeak = this.vocalPeak * 0.72 + combined * 0.28;
        }
      } else {
        this.vocalPeak = Math.max(this.vocalFloor + 8, this.vocalPeak * 0.996);
      }
    }

    const span = Math.max(12, this.vocalPeak - this.vocalFloor);
    const normEnergy = clamp((combined - this.vocalFloor) / span, 0, 1);
    const normFlux = clamp((flux / span) * 2.2, 0, 1);
    const sylDelta = Math.abs(normEnergy - this.prevNormEnergy);
    this.prevNormEnergy = normEnergy;
    this.syllableActivity = this.syllableActivity * 0.78 + clamp(sylDelta * 3.0, 0, 1) * 0.22;
    const sylGate = 0.84 + 0.26 * this.syllableActivity;

    const bassMask = bassAvg > vocalAvg * 3.1 ? 0.72 : 1.0;
    const hatMask = hatAvg > vocalAvg * 1.45 ? 0.72 : 1.0;

    const instantVocal = clamp((normEnergy * 0.72 + normFlux * 0.28) * sylGate * bassMask * hatMask, 0, 1);
    this.smoothVocal = this.smoothVocal * 0.42 + instantVocal * 0.58;

    const bucket = Math.round(posMs / BUCKET_MS);
    const prevB = this.observed.get(bucket);
    this.observed.set(bucket, prevB === undefined ? instantVocal : prevB * 0.4 + instantVocal * 0.6);
    if (this.observed.size > 2400) {
      const oldest = this.observed.keys().next().value;
      if (oldest !== undefined) this.observed.delete(oldest);
    }

    const isVocalNow = formantExcess >= 4.0 && tonality >= 0.18 && this.smoothVocal >= 0.42;
    const isPauseNow = this.smoothVocal < 0.24 || formantExcess < 1.5;

    if (instantVocal >= 0.36 && formantExcess >= 3.0) {
      if (this.pendingOnsetMs < 0) {
        if (this.prevFramePosMs >= 0 && this.prevInstantVocal < 0.55) {
          const frac = clamp((0.55 - this.prevInstantVocal) / Math.max(0.05, instantVocal - this.prevInstantVocal), 0, 1);
          this.pendingOnsetMs = this.prevFramePosMs + (posMs - this.prevFramePosMs) * frac;
        } else {
          this.pendingOnsetMs = posMs;
        }
      }
    } else if (isPauseNow) {
      this.pendingOnsetMs = -1;
    }
    this.prevInstantVocal = instantVocal;
    this.prevFramePosMs = posMs;

    let structureChanged = false;

    const snapStarts = this.segments.map((s) => s.startMs);
    const snapLocked = this.segments.map((s) => s.locked);
    const prevActiveForGuard = this.findActiveLine(posMs);

    if (isVocalNow) {
      this.vocalDurMs += dtMs;
      if (this.pendingPhraseSnapMs < 0 && !this.inVocalPhrase && this.vocalDurMs >= 110 && posMs >= 260) {
        const fallbackOnset = Math.max(posMs - 550, posMs - this.vocalDurMs);
        const onsetMs =
          this.pendingOnsetMs >= 0 && posMs - this.pendingOnsetMs <= 550 ? this.pendingOnsetMs : fallbackOnset;
        const precededByPause = this.silenceDurMs >= 260 || onsetMs < this.segments[0].startMs + 2800;
        if (precededByPause && onsetMs - this.lastPhraseOnsetMs >= 650) {
          this.pendingPhraseSnapMs = onsetMs;
        }
      }
      const onsetThresholdMs = this.silenceDurMs >= 600 ? 220 : 320;
      if (!this.inVocalPhrase && this.vocalDurMs >= onsetThresholdMs && posMs >= 360) {
        this.inVocalPhrase = true;
        if (this.pendingPhraseSnapMs >= 0) {
          const onsetMs = this.pendingPhraseSnapMs;
          const res = this.snapNearestLineToPhraseOnset(onsetMs);
          if (res) {
            this.lastPhraseOnsetMs = onsetMs;
            this.pendingPhraseSnapMs = -1;
            structureChanged = true;
          } else if (this.segments[0]?.locked) {

            const active = this.findActiveLine(onsetMs);
            const targetSeg = active >= 0 ? this.segments[active] : undefined;
            if (targetSeg?.locked && onsetMs >= targetSeg.startMs - 220) {
              this.pendingPhraseSnapMs = -1;
            }
          }
        }
        this.silenceDurMs = 0;
      } else if (this.inVocalPhrase && this.pendingPhraseSnapMs >= 0 && this.vocalDurMs >= 880) {
        const onsetMs = this.pendingPhraseSnapMs;
        this.pendingPhraseSnapMs = -1;
        if (this.snapNearestLineToPhraseOnset(onsetMs)) {
          this.lastPhraseOnsetMs = onsetMs;
          structureChanged = true;
        }
      }
    } else if (isPauseNow) {
      this.silenceDurMs += dtMs;
      this.vocalDurMs = Math.max(0, this.vocalDurMs - dtMs * 0.5);
      if (this.silenceDurMs >= 240) {
        this.inVocalPhrase = false;
        this.vocalDurMs = 0;
        this.pendingOnsetMs = -1;
        this.pendingPhraseSnapMs = -1;
      }
    }

    if (!this.globalCalibrated && this.observed.size >= 55 && posMs >= Math.max(5200, (this.segments[0]?.startMs ?? 0) + 2600)) {
      this.globalCalibrated = true;
      if (this.fineCalibrateGlobalDelay()) {
        structureChanged = true;
      }
    }

    if (!this.tempoCalibrated && this.observed.size >= 85 && posMs >= Math.max(8500, (this.segments[0]?.startMs ?? 0) + 4800)) {
      this.tempoCalibrated = true;
      if (this.calibrateTempoScale(posMs)) {
        structureChanged = true;
      }
    }

    if (
      !this.prescanned &&
      this.segments[0]?.locked &&
      (this.inVocalPhrase || this.silenceDurMs < 900) &&
      posMs >= 5500 &&
      this.observed.size >= 24 &&
      posMs - this.lastClusterWarpPosMs >= 1200 &&
      posMs - this.lastStructChangePosMs >= 2600
    ) {
      this.lastClusterWarpPosMs = posMs;
      if (this.microWarpActiveCluster(posMs)) {
        structureChanged = true;
      }
    }

    if (structureChanged && posMs > 3000 && prevActiveForGuard >= 0) {
      const newActive = this.findActiveLine(posMs);
      if (newActive < prevActiveForGuard) {
        for (let i = 0; i < this.segments.length; i++) {
          this.segments[i].startMs = snapStarts[i];
          this.segments[i].locked = snapLocked[i];
        }
        this.recomputeNextBounds();
        structureChanged = false;
      }
    }
    if (structureChanged) this.lastStructChangePosMs = posMs;

    const activeIdx = this.findActiveLine(posMs);
    if (activeIdx !== this.curLineIdx) {
      this.curLineIdx = activeIdx;
      this.curLineActiveVocalMs = 0;
      this.curLineSilentTailMs = 0;
      if (activeIdx >= 0) {
        const seg = this.segments[activeIdx];
        this.curLineProgress = clamp((posMs - seg.startMs) / Math.max(300, seg.singDurationMs), 0, 1);
      } else {
        this.curLineProgress = 0;
      }
    } else if (activeIdx >= 0) {
      const seg = this.segments[activeIdx];
      const elapsedInLine = Math.max(0, posMs - seg.startMs);
      const gapToNext = Math.max(400, seg.nextStartMs - seg.startMs);

      if (isVocalNow) {
        this.curLineActiveVocalMs += dtMs;
        this.curLineSilentTailMs = 0;
        const intensityMod = 0.88 + this.smoothVocal * 0.28;
        const targetProg = clamp((elapsedInLine / Math.max(320, seg.singDurationMs)) * intensityMod, 0, 1);
        this.curLineProgress = Math.max(this.curLineProgress, targetProg);
      } else {
        if (isPauseNow) this.curLineSilentTailMs += dtMs;
        const timeProg = clamp(elapsedInLine / Math.max(320, seg.singDurationMs), 0, 1);
        const step = (dtMs * 0.65) / Math.max(350, seg.singDurationMs);
        this.curLineProgress = Math.max(this.curLineProgress, Math.min(0.99, Math.max(this.curLineProgress + step, timeProg * 0.92)));
      }
    }

    if (structureChanged) {
      this.adjustedCount = this.segments.filter(
        (s) => s.locked || Math.abs(s.startMs - s.baseStartMs) >= 90 || Math.abs(s.lineSpeed - 1) >= 0.04
      ).length;
      this.note =
        this.adjustedCount > 0
          ? `ИИ: выровнено построчно (${this.adjustedCount} стр., темп и паузы)`
          : 'ИИ: построчная синхронизация и контроль пауз';

      const now = performance.now();
      if (now - this.lastSaveAt > 2500) {
        this.lastSaveAt = now;
        saveLinePatches(this.trackId, this.segments);
      }
    }

    return {
      segments: this.segments,
      activeLineIndex: activeIdx,
      lineWordProgress: this.curLineProgress,
      adjustedLinesCount: this.adjustedCount,
      structureChanged,
      note: this.note,
      confidence: clamp(0.76 + Math.min(0.22, this.adjustedCount * 0.03), 0.76, 0.99)
    };
  }

  private fineCalibrateGlobalDelay(): boolean {
    const pts: [number, number][] = [];
    let activeCount = 0;
    for (const [b, v] of this.observed) {
      pts.push([b * BUCKET_MS, v]);
      if (v >= 0.42) activeCount++;
    }
    if (pts.length < 30 || activeCount < 6) return false;

    const scoreShift = (shiftMs: number): number => {
      let sum = 0;
      for (const [t, obs] of pts) {
        const exp = this.expectedVocalAt(t - shiftMs);
        sum += (obs - 0.4) * (exp - 0.4) * 2.1 - Math.abs(obs - exp) * 0.25;
      }
      return sum / pts.length;
    };

    const baseScore = scoreShift(0);
    let bestShift = 0;
    let bestScore = baseScore;
    for (let s = -1800; s <= 1800; s += 80) {
      if (s === 0) continue;
      const sc = scoreShift(s) - Math.abs(s) * 0.000012;
      if (sc > bestScore) {
        bestScore = sc;
        bestShift = s;
      }
    }

    const coarseGlobal = bestShift;
    for (let s = coarseGlobal - 85; s <= coarseGlobal + 85; s += 2) {
      const sc = scoreShift(s) - Math.abs(s) * 0.000012;
      if (sc > bestScore) {
        bestScore = sc;
        bestShift = s;
      }
    }

    if (Math.abs(bestShift) >= 45 && bestScore - baseScore >= 0.028) {
      let pastBreak = false;
      for (let i = 0; i < this.segments.length; i++) {
        const seg = this.segments[i];

        if (i > 0) {
          const prev = this.segments[i - 1];
          const gap = seg.baseStartMs - (prev.baseStartMs + prev.singDurationMs);
          if (gap > 3200) pastBreak = true;
        }

        if (this.lastPosMs >= 0 && seg.startMs <= this.lastPosMs + 120) {
          if (!pastBreak) seg.locked = true;
          continue;
        }
        const shifted = Math.max(0, seg.startMs + bestShift);
        seg.startMs = this.lastPosMs >= 0 ? Math.max(this.lastPosMs + 140, shifted) : shifted;
        if (!pastBreak) seg.locked = true;
      }
      this.recomputeNextBounds();
      return true;
    }
    return false;
  }

  private calibrateTempoScale(posMs: number): boolean {
    const pts: [number, number][] = [];
    let activeCount = 0;
    for (const [b, v] of this.observed) {
      const t = b * BUCKET_MS;
      if (t <= posMs + 100) {
        pts.push([t, v]);
        if (v >= 0.42) activeCount++;
      }
    }
    if (pts.length < 70 || activeCount < 16) return false;

    const score2D = (shift: number, rate: number): number => {
      let sum = 0;
      for (const [t, obs] of pts) {
        const origT = (t - shift) / rate;
        const idx = this.findBaseActiveLine(origT);
        let exp = 0.06;
        if (idx >= 0) {
          const seg = this.segments[idx];
          const el = origT - seg.baseStartMs;
          exp = el <= 220 ? 0.96 : 0.84;
        }
        sum += (obs - 0.42) * (exp - 0.42) * 2.0 - Math.abs(obs - exp) * 0.25;
      }
      return sum / pts.length;
    };

    let bestUnitScore = score2D(0, 1.0);
    for (let sh = -2200; sh <= 2200; sh += 100) {
      const sc = score2D(sh, 1.0);
      if (sc > bestUnitScore) bestUnitScore = sc;
    }

    let bestRate = 1.0;
    let bestShift = 0;
    let bestScore = bestUnitScore;
    for (let r = 0.90; r <= 1.105; r += 0.02) {
      if (Math.abs(r - 1.0) < 0.015) continue;
      for (let sh = -1800; sh <= 1800; sh += 150) {
        const sc = score2D(sh, r);
        if (sc > bestScore) {
          bestScore = sc;
          bestRate = r;
          bestShift = sh;
        }
      }
    }
    if (Math.abs(bestRate - 1.0) < 0.025 || bestScore - bestUnitScore < 0.085) {
      return false;
    }

    const cR = bestRate;
    const cS = bestShift;
    for (let r = Math.max(0.89, cR - 0.018); r <= Math.min(1.11, cR + 0.018); r += 0.002) {
      for (let sh = cS - 140; sh <= cS + 140; sh += 10) {
        const sc = score2D(sh, r);
        if (sc > bestScore) {
          bestScore = sc;
          bestRate = r;
          bestShift = sh;
        }
      }
    }

    const fS = bestShift;
    for (let sh = fS - 12; sh <= fS + 12; sh += 2) {
      const sc = score2D(sh, bestRate);
      if (sc > bestScore) {
        bestScore = sc;
        bestShift = sh;
      }
    }

    if (bestScore - bestUnitScore < 0.085) return false;

    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i];
      if (i > 0) {
        const prev = this.segments[i - 1];
        if (seg.baseStartMs - (prev.baseStartMs + prev.singDurationMs) > 3200) break;
      }
      if (seg.startMs <= posMs + 80) {
        seg.locked = true;
        continue;
      }
      const targetStart = Math.max(posMs + 90, bestShift + seg.baseStartMs * bestRate);
      seg.startMs = targetStart;
      seg.singDurationMs = Math.max(380, seg.singDurationMs * bestRate);
      seg.lineSpeed = clamp(1 / bestRate, 0.72, 1.38);
      seg.locked = true;
    }
    this.recomputeNextBounds();
    return true;
  }

  private microWarpActiveCluster(posMs: number): boolean {
    const activeIdx = this.findActiveLine(posMs);
    const centerIdx = Math.min(this.segments.length - 1, Math.max(0, activeIdx + 1));
    if (this.segments[centerIdx].startMs <= posMs + 150) return false;
    const windowStart = Math.max(0, posMs - 6500);
    const windowEnd = posMs + 1200;

    const pts: [number, number][] = [];
    let activeCount = 0;
    let recentActive = 0;
    for (const [b, v] of this.observed) {
      const t = b * BUCKET_MS;
      if (t >= windowStart && t <= windowEnd) {
        pts.push([t, v]);
        if (v >= 0.42) {
          activeCount++;
          if (t >= posMs - 4500) recentActive++;
        }
      }
    }
    if (pts.length < 18 || activeCount < 6 || recentActive < 3) return false;

    const span = Math.max(1000, windowEnd - windowStart);
    const scoreShift = (shiftMs: number): number => {
      let sum = 0;
      let wSum = 0;
      for (const [t, obs] of pts) {
        const w = 0.45 + 0.55 * ((t - windowStart) / span);
        const exp = this.expectedVocalAt(t - shiftMs);
        sum += w * ((obs - 0.42) * (exp - 0.42) * 2.0 - Math.abs(obs - exp) * 0.3);
        wSum += w;
      }
      return sum / Math.max(1, wSum);
    };

    const baseScore = scoreShift(0);
    let bestShift = 0;
    let bestScore = baseScore;

    for (let s = -900; s <= 900; s += 100) {
      if (s === 0) continue;
      const sc = scoreShift(s) - Math.abs(s) * 0.000015;
      if (sc > bestScore) {
        bestScore = sc;
        bestShift = s;
      }
    }
    if (Math.abs(bestShift) >= 100) {
      const coarse = bestShift;
      for (let s = Math.max(-950, coarse - 90); s <= Math.min(950, coarse + 90); s += 10) {
        const sc = scoreShift(s) - Math.abs(s) * 0.000015;
        if (sc > bestScore) {
          bestScore = sc;
          bestShift = s;
        }
      }
    }

    if (Math.abs(bestShift) >= 130 && bestScore - baseScore >= 0.11) {
      if (!this.verifyMultiLineCadence(centerIdx, bestShift, posMs)) {
        return false;
      }
      const prevShift = this.segments[centerIdx].startMs - this.segments[centerIdx].baseStartMs;
      this.applyElasticLineShift(centerIdx, bestShift, 10, false, posMs, true);

      if (prevShift * bestShift > 0 && Math.abs(prevShift) >= 80) {
        const stepDrift = clamp(bestShift * 0.35, -140, 140);
        for (let k = centerIdx + 1; k < this.segments.length; k++) {
          const prev = this.segments[k - 1];
          const cur = this.segments[k];
          if (cur.baseStartMs - (prev.baseStartMs + prev.singDurationMs) > 3200) break;
          const minSafe = prev.startMs + prev.singDurationMs * 0.85;
          const nextStart = Math.max(minSafe, cur.startMs + stepDrift * (k - centerIdx));
          cur.startMs = Math.max(posMs + 140, nextStart);
        }
        this.recomputeNextBounds();
      }
      return true;
    }
    return false;
  }

  private expectedVocalAt(ms: number): number {
    const idx = this.findActiveLine(ms);
    if (idx < 0) return 0.05;
    const seg = this.segments[idx];
    const elapsed = ms - seg.startMs;
    const roleScale = seg.voiceRole === 'backing' ? 0.65 : 1.0;
    if (elapsed <= seg.singDurationMs && seg.contour?.length === 16) {
      const bin = clamp(Math.floor((elapsed / Math.max(1, seg.singDurationMs)) * 16), 0, 15);
      return seg.contour[bin] * roleScale;
    }
    if (elapsed <= 280) return 0.96 * roleScale;
    if (elapsed <= seg.singDurationMs) return 0.8 * roleScale;
    return 0.08;
  }

  private verifyMultiLineCadence(centerIdx: number, deltaMs: number, posMs: number): boolean {
    if (centerIdx > 0 && deltaMs < 0) {
      const prev = this.segments[centerIdx - 1];
      const cur = this.segments[centerIdx];
      const shiftedStart = cur.startMs + deltaMs;
      if (shiftedStart < prev.startMs + prev.singDurationMs * 0.85) {
        return false;
      }
    }

    const fromI = Math.max(0, centerIdx - 1);
    const toI = Math.min(this.segments.length - 1, centerIdx + 2);
    const windows: [number, number][] = [];
    for (let k = fromI; k <= toI; k++) {
      const s = this.segments[k];
      const shiftK = k >= centerIdx ? deltaMs : 0;
      const wStart = Math.min(s.startMs, s.startMs + shiftK) - 220;
      const wEnd = Math.max(s.startMs, s.startMs + shiftK) + s.singDurationMs + 220;
      windows.push([wStart, wEnd]);
    }

    let baseSum = 0;
    let shiftSum = 0;
    let count = 0;
    for (const [b, obs] of this.observed) {
      const t = b * BUCKET_MS;
      if (t > posMs + 150) continue;
      if (!windows.some(([a, z]) => t >= a && t <= z)) continue;
      const expBase = this.expectedVocalAt(t);
      const expShift = t >= this.segments[centerIdx].startMs + Math.min(0, deltaMs) - 220
        ? this.expectedVocalAt(t - deltaMs)
        : expBase;
      baseSum += (obs - 0.42) * (expBase - 0.42) * 2.0 - Math.abs(obs - expBase) * 0.3;
      shiftSum += (obs - 0.42) * (expShift - 0.42) * 2.0 - Math.abs(obs - expShift) * 0.3;
      count++;
    }

    if (count < 8) return true;
    const baseAvg = baseSum / count;
    const shiftAvg = shiftSum / count;
    if (shiftAvg < baseAvg - 0.03) return false;
    if (deltaMs < -220 && shiftAvg <= baseAvg + 0.015) return false;
    return true;
  }

  private snapNearestLineToPhraseOnset(onsetMs: number): boolean {

    if (this.segments.length > 0 && !this.segments[0].locked) {
      const matchesLaterLine =
        this.segments[0].startMs < 1200 &&
        this.segments.slice(1, 3).some((s) => Math.abs(onsetMs - s.startMs) < 550);
      if (matchesLaterLine) {
        this.segments[0].locked = true;
        return false;
      }
      const d0 = onsetMs - this.segments[0].startMs;
      if (Math.abs(d0) <= 8500) {

        const earlyReqMs = Math.max(850, Math.min(1150, this.segments[0].singDurationMs * 0.65));
        if (d0 < -90 && this.vocalDurMs < earlyReqMs) {
          return false;
        }
        if (Math.abs(d0) >= 60) {
          if (!this.verifyMultiLineCadence(0, d0, Math.max(onsetMs, this.lastPosMs))) {
            return false;
          }
          this.applyElasticLineShift(0, d0, 8, false, onsetMs);
          return true;
        }
        this.segments[0].locked = true;
        return false;
      }
    }

    let bestIdx = -1;
    let bestScore = Infinity;

    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i];
      if (seg.locked) continue;
      const prevEnd = i > 0 ? this.segments[i - 1].startMs + this.segments[i - 1].singDurationMs : 0;
      const gapBefore = i === 0 ? seg.startMs : seg.startMs - prevEnd;

      if (i > 0 && gapBefore < 950) continue;

      const d = onsetMs - seg.startMs;
      const absD = Math.abs(d);
      const isClusterOpener = gapBefore > 2200;

      const maxWindow = isClusterOpener ? 4200 : Math.min(340, Math.max(220, gapBefore * 0.35));
      if (absD <= maxWindow) {

        const weightedDist = isClusterOpener ? absD * 0.15 : absD;
        if (weightedDist < bestScore) {
          bestScore = weightedDist;
          bestIdx = i;
        }
      }
    }

    if (bestIdx < 0) return false;

    const target = this.segments[bestIdx];
    const delta = onsetMs - target.startMs;

    const earlyReqMs = Math.max(850, Math.min(1150, target.singDurationMs * 0.65));
    if (delta < -220 && this.vocalDurMs < earlyReqMs) {
      return false;
    }
    if (Math.abs(delta) < 140) {
      target.locked = true;
      return false;
    }
    if (!this.verifyMultiLineCadence(bestIdx, delta, Math.max(onsetMs, this.lastPosMs))) {
      return false;
    }
    this.applyElasticLineShift(bestIdx, delta, 8, false, onsetMs);
    return true;
  }

  private applyElasticLineShift(
    centerIdx: number,
    deltaMs: number,
    radius: number,
    includePrev: boolean,
    curPosMs = Infinity,
    forceOverride = false
  ): void {
    const startI = includePrev ? Math.max(0, centerIdx - 1) : centerIdx;
    const endI = Math.min(this.segments.length - 1, centerIdx + radius);

    const eligible: number[] = [];
    let minFutureStart = Infinity;
    for (let i = startI; i <= endI; i++) {
      const seg = this.segments[i];
      const isActiveOrPast = curPosMs < Infinity && i > centerIdx && seg.startMs <= curPosMs + 120 && deltaMs < 0;
      if (isActiveOrPast) continue;
      if (seg.locked && (!forceOverride || seg.startMs < curPosMs + 150)) continue;
      if (i > centerIdx) {
        const prev = this.segments[i - 1];
        const gap = this.segments[i].baseStartMs - (prev.baseStartMs + prev.singDurationMs);
        if (gap > 3200) break;
      }
      eligible.push(i);
      if (curPosMs < Infinity && seg.startMs > curPosMs + 120) {
        minFutureStart = Math.min(minFutureStart, seg.startMs);
      }
    }
    if (eligible.length === 0) return;

    let delta = deltaMs;
    if (delta < 0 && Number.isFinite(minFutureStart) && curPosMs < Infinity) {

      delta = Math.max(delta, curPosMs + 140 - minFutureStart);
      if (delta > -20) return;
    }

    for (const i of eligible) {
      const seg = this.segments[i];
      const minStart = Math.max(seg.baseStartMs - 5500, 0);
      const maxStart = seg.baseStartMs + 5500;
      seg.startMs = clamp(Math.round(seg.startMs + delta), minStart, maxStart);
      seg.locked = true;
    }

    this.recomputeNextBounds();
  }

  private recomputeNextBounds(): void {
    for (let i = 0; i < this.segments.length; i++) {
      const cur = this.segments[i];
      const next = this.segments[i + 1];
      if (next) {
        const minGap = Math.max(450, Math.min(900, Math.round((next.baseStartMs - cur.baseStartMs) * 0.65)));
        if (next.startMs < cur.startMs + minGap) {
          next.startMs = cur.startMs + minGap;
        }
        cur.nextStartMs = next.startMs;
        cur.singDurationMs = clamp(cur.singDurationMs, 360, Math.max(380, cur.nextStartMs - cur.startMs - 110));
      } else {
        cur.nextStartMs = cur.startMs + Math.max(3500, cur.singDurationMs + 800);
      }
    }
  }

  private findBaseActiveLine(ms: number): number {
    if (this.segments.length === 0 || ms < this.segments[0].baseStartMs - 60) return -1;
    let lo = 0;
    let hi = this.segments.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.segments[mid].baseStartMs <= ms + 50) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    const seg = ans >= 0 ? this.segments[ans] : null;
    if (seg && ms > seg.baseStartMs + seg.singDurationMs) return -1;
    return ans;
  }

  findActiveLine(ms: number): number {
    if (this.segments.length === 0 || ms < this.segments[0].startMs - 60) return -1;
    let lo = 0;
    let hi = this.segments.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.segments[mid].startMs <= ms + 50) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  }
}
