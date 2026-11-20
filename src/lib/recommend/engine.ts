import { get } from 'svelte/store';
import { getAiBrainScoreBonus, reinforceFromListen } from '$lib/ai/trainer';
import { ipc } from '$lib/api/arima';
import { sc } from '$lib/api/soundcloud';
import { auth } from '$lib/stores/auth';
import { likedIds, likedTracks, likesStatus, loadLikes } from '$lib/stores/library';
import { player, playerActions } from '$lib/stores/player';
import { settings } from '$lib/stores/settings';
import type { Playlist, TasteProfile, Track } from '$lib/types';
import { clamp, isPlayable, isRemixTrack, normalizeTrack, shuffled } from '$lib/utils';

const POOL_TTL_MS = 10 * 60_000;
const MAX_DURATION_MS = 12 * 60_000;

interface Pool {
  tracks: Track[];
  at: number;
}

let pool: Pool | null = null;
let profileCache: { p: TasteProfile; at: number } | null = null;

const sessionSkippedGenres = new Map<string, number>();
const sessionSkippedArtists = new Map<number, number>();
const sessionEnjoyedGenres = new Map<string, number>();
const sessionSkippedTokens = new Map<string, number>();
const recentEnergies: number[] = [];
const graphHits = new Map<number, number>();
let consecutiveSkips = 0;

const JUNK_WAVE_RX = /\b(type\s*beat|free\s*beat|sample\s*pack|loop\s*kit|podcast|interview|1\s*hour|compilation|dj\s*set|acapella)\b/i;

export function energyOf(t: Track): number {
  const s = `${t.genre ?? ''} ${t.tag_list ?? ''} ${t.title ?? ''} ${t.badge ?? ''}`.toLowerCase();
  let e = 0.55;
  if (/phonk|drift|cowbell|bass\s*boosted|speed\s*up|sped\s*up|nightcore|techno|hardstyle|dnb|drum/.test(s)) {
    e += 0.28;
  } else if (/trap|drill|edm|house|electronic|dance|electro|rap|hip/.test(s)) {
    e += 0.14;
  }
  if (/slowed|reverb|ambient|lofi|lo-fi|chill|sleep|sad|acoustic|piano|study/.test(s)) {
    e -= 0.28;
  }
  if (t.duration > 0 && t.duration < 135_000) e += 0.06;
  if (t.duration > 260_000) e -= 0.08;
  return clamp(e, 0.12, 0.96);
}

function titleTokens(t: Track): string[] {
  return (t.title ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3);
}

export function recordSessionFeedback(t: Track, skipped: boolean): boolean {
  const g = norm(t.genre);
  const aid = t.user?.id;
  const e = energyOf(t);
  reinforceFromListen(t, skipped ? -0.75 : 0.75);
  if (skipped) {
    consecutiveSkips++;
    if (g) sessionSkippedGenres.set(g, (sessionSkippedGenres.get(g) ?? 0) + 1);
    if (aid) sessionSkippedArtists.set(aid, (sessionSkippedArtists.get(aid) ?? 0) + 1);
    for (const tok of titleTokens(t)) {
      sessionSkippedTokens.set(tok, (sessionSkippedTokens.get(tok) ?? 0) + 1);
    }
    if (consecutiveSkips >= 2) {
      pool = null;
      return true;
    }
  } else {
    consecutiveSkips = 0;
    if (g) sessionEnjoyedGenres.set(g, (sessionEnjoyedGenres.get(g) ?? 0) + 1);
    recentEnergies.push(e);
    if (recentEnergies.length > 8) recentEnergies.shift();
  }
  return false;
}

async function profile(): Promise<TasteProfile> {
  if (profileCache && Date.now() - profileCache.at < 60_000) return profileCache.p;
  const p = await ipc.history.taste().catch(
    (): TasteProfile => ({ genres: {}, artists: {}, tags: {}, recentIds: [], skippedIds: [], totalPlays: 0 })
  );
  profileCache = { p, at: Date.now() };
  return p;
}

export function invalidateTaste(): void {
  profileCache = null;
  pool = null;
}

const norm = (s: string | undefined): string => (s ?? '').trim().toLowerCase();

export function canonicalKey(t: Track): string {
  let s = (t.title ?? '').toLowerCase();
  if (s.includes(' - ')) {
    const parts = s.split(' - ');
    s = parts.slice(1).join(' ');
  }
  s = s
    .replace(/[\u3164\u200b-\u200f\ufeff]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(
      /\b(feat|ft|prod|прод|remix|ремикс|slowed|reverb|speed\s*up|sped\s*up|nightcore|bass\s*boosted|edit|version|ver|mix|бонус|bonus|слив|демка|demo|без\s*цензуры)\b/g,
      ' '
    )
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) s = (t.title ?? '').toLowerCase().trim();
  const durBucket = Math.round((t.duration ?? 0) / 15_000);
  return `${s}#${durBucket}`;
}

function tagsOf(t: Track): string[] {
  const out: string[] = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t.tag_list ?? ''))) out.push(norm(m[1] ?? m[2]));
  return out;
}

export function score(t: Track, p: TasteProfile): number {
  const g = p.genres[norm(t.genre)] ?? 0;
  const a = p.artists[String(t.user?.id)] ?? 0;
  const tags = tagsOf(t);
  let tg = 0;
  for (const tag of tags) tg = Math.max(tg, p.tags[tag] ?? 0);
  const pop = Math.log10((t.playback_count ?? 0) + 10) / 8;
  const likedRatio =
    t.playback_count && t.likes_count ? Math.min(1, (t.likes_count / t.playback_count) * 18) : 0.25;
  const novelty = a === 0 ? 0.14 : 0;

  const hr = new Date().getHours();
  const genreStr = `${norm(t.genre)} ${tags.join(' ')}`;
  let moodBias = 0;
  if (hr >= 23 || hr < 6) {
    if (/ambient|chill|lofi|lo-fi|sad|piano|dream/.test(genreStr)) moodBias = 0.08;
  } else if (hr >= 10 && hr < 20) {
    if (/electronic|house|phonk|trap|hip|dance|techno/.test(genreStr)) moodBias = 0.06;
  }

  const skipG = sessionSkippedGenres.get(norm(t.genre)) ?? 0;
  const skipA = t.user?.id ? (sessionSkippedArtists.get(t.user.id) ?? 0) : 0;
  const enjoyG = sessionEnjoyedGenres.get(norm(t.genre)) ?? 0;
  let tokSkipPenalty = 0;
  for (const tok of titleTokens(t)) {
    tokSkipPenalty += (sessionSkippedTokens.get(tok) ?? 0) * 0.08;
  }
  const sessionBias =
    Math.min(0.14, enjoyG * 0.05) -
    Math.min(0.35, skipG * 0.18) -
    Math.min(0.45, skipA * 0.28) -
    Math.min(0.25, tokSkipPenalty);

  const hits = graphHits.get(t.id) ?? 1;
  const consensusBonus = hits > 1 ? Math.min(0.26, (hits - 1) * 0.1) : 0;

  let energyBonus = 0;
  if (recentEnergies.length > 0) {
    const avgE = recentEnergies.reduce((a, b) => a + b, 0) / recentEnergies.length;
    energyBonus = (1 - Math.abs(energyOf(t) - avgE)) * 0.08;
  }

  const aiBonus = getAiBrainScoreBonus(t);

  return Math.max(
    0,
    0.31 * g +
      0.21 * a +
      0.16 * tg +
      0.11 * Math.min(1, pop) +
      0.12 * likedRatio +
      novelty +
      moodBias +
      sessionBias +
      consensusBonus +
      energyBonus +
      aiBonus
  );
}

function weightedPick<T>(items: T[], weight: (x: T) => number, n: number): T[] {
  const left = items.slice();
  const out: T[] = [];
  while (out.length < n && left.length) {
    const w = left.map((x) => weight(x) + 0.05);
    let r = Math.random() * w.reduce((s, x) => s + x, 0);
    let i = 0;
    while (i < left.length - 1 && (r -= w[i]) > 0) i++;
    out.push(left.splice(i, 1)[0]);
  }
  return out;
}

function primaryArtistKey(t: Track | null | undefined): string {
  return (t?.user?.username ?? '')
    .toLowerCase()
    .split(',')[0]
    .replace(/\s+/g, ' ')
    .trim();
}

function sameArtist(a: Track | null | undefined, b: Track | null | undefined): boolean {
  if (!a || !b) return false;
  if (a.user?.id && b.user?.id && a.user.id === b.user.id) return true;
  const ka = primaryArtistKey(a);
  const kb = primaryArtistKey(b);
  return Boolean(ka && kb && ka === kb);
}

function sequenceWaveFlow(list: Track[], startEnergy: number): Track[] {
  const out: Track[] = [];
  const counts = new Map<string, number>();
  const rest = list.slice();
  let curEnergy = startEnergy;

  while (rest.length) {
    const lastTrack = out[out.length - 1];
    let bestIdx = -1;
    let bestFlow = -Infinity;

    for (let i = 0; i < rest.length; i++) {
      const cand = rest[i];
      const ak = primaryArtistKey(cand) || String(cand.user?.id ?? cand.id);
      if (sameArtist(cand, lastTrack) || (counts.get(ak) ?? 0) >= 2) continue;

      const rankBonus = 1 - i / Math.max(1, rest.length);
      const energySmoothness = 1 - Math.abs(energyOf(cand) - curEnergy);
      const flow = rankBonus * 0.62 + energySmoothness * 0.38;
      if (flow > bestFlow) {
        bestFlow = flow;
        bestIdx = i;
      }
    }

    if (bestIdx < 0) bestIdx = rest.findIndex((t) => !sameArtist(t, lastTrack));
    if (bestIdx < 0) bestIdx = 0;

    const picked = rest.splice(bestIdx, 1)[0];
    const ak = primaryArtistKey(picked) || String(picked.user?.id ?? picked.id);
    counts.set(ak, (counts.get(ak) ?? 0) + 1);
    curEnergy = curEnergy * 0.4 + energyOf(picked) * 0.6;
    out.push(picked);
  }
  return out;
}

function diversify(list: Track[]): Track[] {
  const cur = get(player).current;
  const startE = cur ? energyOf(cur) : recentEnergies[recentEnergies.length - 1] ?? 0.6;
  return sequenceWaveFlow(list, startE);
}

function dedupeCandidates(
  candidates: Track[],
  seenIds: Set<number>,
  seenKeys: Set<string>,
  skippedIds: Set<number>
): Track[] {
  const ui = get(settings).ui;
  const hideDuplicates = ui?.hideDuplicates ?? true;
  const hideRemixes = ui?.hideRemixes ?? false;
  const out: Track[] = [];
  for (const raw of candidates) {
    if (!raw?.id || !raw.title || !isPlayable(raw)) continue;
    if (raw.duration > MAX_DURATION_MS || JUNK_WAVE_RX.test(raw.title)) continue;
    if (seenIds.has(raw.id) || skippedIds.has(raw.id)) continue;
    const t = normalizeTrack(raw);
    if (hideRemixes && isRemixTrack(t)) continue;
    const key = canonicalKey(t);
    if (hideDuplicates && seenKeys.has(key)) continue;
    seenIds.add(t.id);
    seenKeys.add(key);
    out.push(t);
  }
  return out;
}

async function seeds(p: TasteProfile, n: number): Promise<Track[]> {
  const liked = get(likedTracks).slice(0, 300);
  let hist: Track[] = [];
  try {
    hist = (await ipc.history.list(100)).map((h) => h.track);
  } catch {

  }
  const unique = new Map<number, Track>();
  for (const t of [...liked, ...hist]) unique.set(t.id, t);
  const all = [...unique.values()].filter((t) => isPlayable(t) && t.duration <= MAX_DURATION_MS);
  return weightedPick(all, (t) => score(t, p) * (liked.some((l) => l.id === t.id) ? 1.4 : 1), n);
}

async function ensureLikesLoaded(): Promise<void> {
  if (get(auth).status !== 'authenticated') return;
  const st = get(likesStatus);
  if (st.done) return;
  await Promise.race([
    loadLikes().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 4000))
  ]);
}

function filterOutLikedAndHistory(tracks: Track[], p: TasteProfile): Track[] {
  const likedIdSet = get(likedIds);
  const likedList = get(likedTracks);
  const likedKeys = new Set<string>(likedList.map((t) => canonicalKey(t)));
  const recentSet = new Set<number>(p.recentIds);
  const skipSet = new Set<number>(p.skippedIds);
  const hideRemixes = get(settings).ui?.hideRemixes ?? false;
  return tracks.filter((t) => {
    if (!t?.id || (t as Track & { user_favorite?: boolean }).user_favorite) return false;
    if (hideRemixes && isRemixTrack(t)) return false;
    if (likedIdSet.has(t.id) || recentSet.has(t.id) || skipSet.has(t.id)) return false;
    if (likedKeys.has(canonicalKey(t))) return false;
    return true;
  });
}

async function buildExclusionSets(p: TasteProfile): Promise<{ seenIds: Set<number>; seenKeys: Set<string>; skipped: Set<number> }> {
  await ensureLikesLoaded();
  const seenIds = new Set<number>([...p.recentIds, ...get(likedIds)]);
  const seenKeys = new Set<string>();
  const skipped = new Set<number>(p.skippedIds);

  for (const t of get(likedTracks)) {
    if (!t?.id) continue;
    seenIds.add(t.id);
    seenKeys.add(canonicalKey(t));
  }

  try {
    const [hist, scHist] = await Promise.all([
      ipc.history.list(500).catch(() => []),
      get(auth).status === 'authenticated' ? sc.playHistory(50).catch(() => [] as Track[]) : Promise.resolve([] as Track[])
    ]);
    for (const h of hist) {
      if (!h.track?.id) continue;
      seenIds.add(h.track.id);
      seenKeys.add(canonicalKey(h.track));
    }
    for (const t of scHist) {
      if (!t?.id) continue;
      seenIds.add(t.id);
      seenKeys.add(canonicalKey(t));
    }
  } catch {

  }

  return { seenIds, seenKeys, skipped };
}

async function buildPool(): Promise<Track[]> {
  if (pool && Date.now() - pool.at < POOL_TTL_MS) return pool.tracks;
  const p = await profile();
  const sd = await seeds(p, 8);
  let candidates: Track[] = [];
  graphHits.clear();

  if (sd.length) {
    const lists = await Promise.allSettled(sd.map((s) => sc.related(s.id, 30)));
    for (const l of lists) {
      if (l.status === 'fulfilled') {
        for (const tr of l.value) {
          if (tr?.id) graphHits.set(tr.id, (graphHits.get(tr.id) ?? 0) + 1);
          candidates.push(tr);
        }
      }
    }
  }

  if (candidates.length < 40 && candidates.length > 0) {
    const bridge = rank(candidates.slice(0, 20), p, 0.05)[0];
    if (bridge?.id) {
      const hop2 = await sc.related(bridge.id, 25).catch(() => [] as Track[]);
      candidates.push(...hop2);
    }
  }

  if (candidates.length < 25) {
    const charts = await sc.charts('trending', 'all-music', 30).catch(() => [] as Track[]);
    candidates.push(...charts);
  }
  const { seenIds, seenKeys, skipped } = await buildExclusionSets(p);
  const tracks = dedupeCandidates(candidates, seenIds, seenKeys, skipped);
  pool = { tracks, at: Date.now() };
  return tracks;
}

function rank(tracks: Track[], p: TasteProfile, jitter = 0.2): Track[] {
  return tracks
    .map((t) => ({ t, s: score(t, p) + Math.random() * jitter }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.t);
}

export async function waveBatch(
  excludeIds: Set<number> = new Set(),
  excludeKeys: Set<string> = new Set(),
  size = 25
): Promise<Track[]> {
  const p = await profile();
  let tracks = (await buildPool()).filter((t) => !excludeIds.has(t.id) && !excludeKeys.has(canonicalKey(t)));
  if (tracks.length < size) {
    pool = null;
    tracks = (await buildPool()).filter((t) => !excludeIds.has(t.id) && !excludeKeys.has(canonicalKey(t)));
  }
  const ranked = rank(tracks, p, 0.14);

  const coreCount = Math.ceil(size * 0.78);
  const exploreCount = size - coreCount;
  const core = ranked.slice(0, coreCount);
  const tailPool = ranked
    .slice(coreCount)
    .filter((t) => (p.artists[String(t.user?.id)] ?? 0) === 0);
  const explore = (tailPool.length >= exploreCount ? tailPool : ranked.slice(coreCount)).slice(0, exploreCount);
  const batch = diversify([...core, ...explore]);
  for (const t of batch) {
    excludeIds.add(t.id);
    excludeKeys.add(canonicalKey(t));
  }
  if (pool) pool.tracks = pool.tracks.filter((t) => !excludeIds.has(t.id));
  return batch;
}

async function pickWaveTracks(
  excludeIds: Set<number>,
  excludeKeys: Set<string>,
  count: number
): Promise<Track[]> {
  const p = await profile();
  let tracks = filterOutLikedAndHistory(await buildPool(), p).filter(
    (t) => !excludeIds.has(t.id) && !excludeKeys.has(canonicalKey(t))
  );
  if (tracks.length < count) {
    pool = null;
    tracks = filterOutLikedAndHistory(await buildPool(), p).filter(
      (t) => !excludeIds.has(t.id) && !excludeKeys.has(canonicalKey(t))
    );
  } else if (tracks.length < count + 12) {

    void (async () => {
      pool = null;
      await buildPool().catch(() => null);
    })();
  }
  const ranked = rank(tracks, p, 0.03);
  const qState = get(player);
  const anchorPrev = qState.queue[qState.queue.length - 1] ?? qState.current;
  const picked: Track[] = [];
  for (const t of ranked) {
    if (picked.length >= count) break;
    const prevTrack = picked.length > 0 ? picked[picked.length - 1] : anchorPrev;
    if (sameArtist(t, prevTrack)) continue;
    picked.push(t);
    excludeIds.add(t.id);
    excludeKeys.add(canonicalKey(t));
  }
  if (picked.length < count) {
    pool = null;
    const fresh = rank(
      filterOutLikedAndHistory(await buildPool(), p).filter(
        (t) => !excludeIds.has(t.id) && !excludeKeys.has(canonicalKey(t))
      ),
      p,
      0.03
    );
    for (const t of fresh) {
      if (picked.length >= count) break;
      const prevTrack = picked.length > 0 ? picked[picked.length - 1] : anchorPrev;
      if (sameArtist(t, prevTrack)) continue;
      picked.push(t);
      excludeIds.add(t.id);
      excludeKeys.add(canonicalKey(t));
    }
  }
  if (pool) pool.tracks = pool.tracks.filter((t) => !excludeIds.has(t.id));
  return picked;
}

export async function startMyWave(): Promise<boolean> {
  const seenIds = new Set<number>();
  const seenKeys = new Set<string>();
  const first = await pickWaveTracks(seenIds, seenKeys, 4);
  if (!first.length) return false;
  await playerActions.playQueue(first, 0, () => pickWaveTracks(seenIds, seenKeys, 3), 2);
  return true;
}

export async function startWaveFromTrack(seed: Track): Promise<boolean> {
  const p = await profile();
  const { seenIds, seenKeys, skipped } = await buildExclusionSets(p);
  seenIds.add(seed.id);
  seenKeys.add(canonicalKey(seed));

  const rel = await sc.related(seed.id, 35).catch(() => [] as Track[]);
  let batch = diversify(rank(dedupeCandidates(rel, seenIds, seenKeys, skipped), p, 0.14).slice(0, 24));
  const queue = [seed, ...batch];

  await playerActions.playQueue(queue, 0, async () => {
    const anchor = queue[Math.floor(Math.random() * Math.min(queue.length, 6))] ?? seed;
    const more = await sc.related(anchor.id, 30).catch(() => [] as Track[]);
    const fresh = diversify(rank(dedupeCandidates(more, seenIds, seenKeys, skipped), p, 0.16).slice(0, 20));
    if (fresh.length) return fresh;
    return waveBatch(seenIds, seenKeys, 20);
  });
  return true;
}

export async function startWaveFromTracks(sourceTracks: Track[]): Promise<boolean> {
  const playable = sourceTracks.filter((t) => isPlayable(t) && t.duration <= MAX_DURATION_MS);
  if (!playable.length) return false;

  const p = await profile();
  const { seenIds, seenKeys, skipped } = await buildExclusionSets(p);
  const seedsPicked = shuffled(playable).slice(0, 5);
  for (const s of seedsPicked) {
    seenIds.add(s.id);
    seenKeys.add(canonicalKey(s));
  }

  const lists = await Promise.allSettled(seedsPicked.map((s) => sc.related(s.id, 25)));
  const candidates: Track[] = [];
  for (const l of lists) if (l.status === 'fulfilled') candidates.push(...l.value);

  const batch = diversify(rank(dedupeCandidates(candidates, seenIds, seenKeys, skipped), p, 0.15).slice(0, 25));
  const initial = batch.length ? batch : shuffled(playable).slice(0, 20);

  await playerActions.playQueue(initial, 0, async () => {
    const anchor = initial[Math.floor(Math.random() * initial.length)] ?? seedsPicked[0];
    const more = await sc.related(anchor.id, 30).catch(() => [] as Track[]);
    const fresh = diversify(rank(dedupeCandidates(more, seenIds, seenKeys, skipped), p, 0.18).slice(0, 20));
    return fresh.length ? fresh : waveBatch(seenIds, seenKeys, 20);
  });
  return true;
}

export async function forYou(size = 10): Promise<Track[]> {
  const p = await profile();
  const tracks = filterOutLikedAndHistory(await buildPool(), p);
  return diversify(rank(tracks, p, 0.04).slice(0, Math.max(size, 30))).slice(0, size);
}

export async function mixes(maxMixes = 6): Promise<Playlist[]> {
  const p = await profile();
  const tracks = rank(filterOutLikedAndHistory(await buildPool(), p), p, 0.04);
  const out: Playlist[] = [];

  if (tracks.length >= 5) {
    const dailyTracks = diversify(tracks.slice(0, 30));
    out.push({
      id: 'mix:daily',
      title: 'Daily Mix',
      track_count: dailyTracks.length,
      artwork_url: dailyTracks[0]?.artwork_url ?? null,
      tracks: dailyTracks,
      virtual: true
    });
  }

  const hr = new Date().getHours();
  const [moodTitle, moodRx] =
    hr >= 22 || hr < 6
      ? ['Ночной вайб', /ambient|chill|lofi|lo-fi|sad|piano|dream|wave|night/]
      : hr < 12
        ? ['Утренний фокус', /ambient|lofi|lo-fi|instrumental|indie|acoustic|chill|electronic/]
        : hr < 18
          ? ['Дневной ритм', /electronic|house|hip|trap|pop|indie|dance/]
          : ['Вечерний драйв', /phonk|trap|electronic|techno|rock|rap|drill|bass/];

  const moodTracks = tracks.filter((t) => moodRx.test(`${norm(t.genre)} ${tagsOf(t).join(' ')}`));
  if (moodTracks.length >= 5) {
    out.push({
      id: 'mix:ai-mood',
      title: moodTitle,
      track_count: moodTracks.length,
      artwork_url: moodTracks[0]?.artwork_url ?? null,
      tracks: diversify(moodTracks.slice(0, 30)),
      virtual: true
    });
  }

  const discovery = tracks.filter((t) => (p.artists[String(t.user?.id)] ?? 0) === 0);
  if (discovery.length >= 5) {
    out.push({
      id: 'mix:ai-discovery',
      title: 'Открытия ИИ',
      track_count: discovery.length,
      artwork_url: discovery[0]?.artwork_url ?? null,
      tracks: diversify(discovery.slice(0, 30)),
      virtual: true
    });
  }

  const byGenre = new Map<string, Track[]>();
  for (const t of tracks) {
    const g = norm(t.genre);
    if (!g) continue;
    byGenre.set(g, [...(byGenre.get(g) ?? []), t]);
  }
  const genreMixes = [...byGenre.entries()]
    .filter(([, l]) => l.length >= 5)
    .sort((a, b) => (p.genres[b[0]] ?? 0) * b[1].length - (p.genres[a[0]] ?? 0) * a[1].length)
    .slice(0, Math.max(1, maxMixes - out.length))
    .map(([g, l]) => ({
      id: `mix:${g}`,
      title: g.charAt(0).toUpperCase() + g.slice(1),
      track_count: l.length,
      artwork_url: l[0]?.artwork_url ?? null,
      tracks: diversify(l.slice(0, 30)),
      virtual: true
    }));

  return [...out, ...genreMixes].slice(0, maxMixes);
}

export const mixStore = new Map<string, Playlist>();
