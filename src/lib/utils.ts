import type { Track } from '$lib/types';

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
    : `${m}:${String(r).padStart(2, '0')}`;
}

export function formatCount(n: number | undefined): string {
  if (n === undefined) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

export function artwork(
  url: string | null | undefined,
  size: 't50x50' | 't120x120' | 't200x200' | 't300x300' | 't500x500' = 't200x200'
): string {
  if (!url || url.includes('default_avatar')) return '';
  return url.replace(/-(large|t\d+x\d+|original|crop|badge|small|tiny|mini)\./, `-${size}.`);
}

export function trackArtwork(t: Track, size: Parameters<typeof artwork>[1] = 't200x200'): string {
  return artwork(t.artwork_url ?? t.user?.avatar_url, size);
}

export function isPlayable(t: Track): boolean {
  if (!t || t.streamable === false) return false;
  if (t.policy === 'BLOCK' || t.policy === 'SNIP') return false;

  if (typeof t.duration === 'number' && t.duration > 0 && t.duration < 36_000) return false;
  if (t.full_duration && t.duration <= 35_000 && t.full_duration > 45_000) return false;
  if (t.media?.transcodings) {
    if (t.media.transcodings.length === 0) return false;
    if (t.media.transcodings.every((tc) => tc.snipped)) return false;
  }
  return true;
}

const SPAM_PATTERNS = [
  /\[(?:free|free\s*dl|free\s*download|out\s*now|hq|hd|320\s*kbps|unreleased|эксклюзив|слив|без\s*цензуры)[^\]]*\]/gi,
  /\((?:free|free\s*dl|free\s*download|out\s*now|official\s*(?:audio|video|music\s*video|lyric\s*video)|lyric\s*video|audio|hq|hd|320\s*kbps|unreleased|эксклюзив|слив|без\s*цензуры)[^)]*\)/gi,
  /\((?:prod\.?|прод\.?|produced)\s*(?:by)?\s*[^)]+\)/gi,
  /\[(?:prod\.?|прод\.?|produced)\s*(?:by)?\s*[^\]]+\]/gi,
  /\b(?:prod\.?|прод\.?|produced)\s*(?:by\s+)?[\w\s.&$-]+$/gi,
  /\b(?:t\.me\/\S+|@[a-zA-Z0-9_]{3,})\b/g,
  /\.(?:mp3|wav|flac|m4a|ogg)\b/gi,
  /\*(?:[^*]{2,25})\*/g
];

const FEAT_PAREN_RE = /[\(\[]\s*(?:feat\.?|ft\.?|featuring|with|w\/)\s+([^\)\]]+)[\)\]]/gi;
const FEAT_TAIL_RE = /\s+(?:feat\.?|ft\.?|featuring|w\/)\s+([a-zA-Zа-яА-ЯёЁ0-9_.&,+\s-]{2,45})$/i;

function stripInvisibleAndZalgo(s: string): string {
  return s
    .replace(/[\u0300-\u036f\u0483-\u0489\u3164\u200b-\u200f\ufeff]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function appendUniqueArtists(base: string, extras: string[]): string {
  const list = base
    .split(/\s*(?:,|&|\+|\/)\s*/)
    .map((x) => x.trim())
    .filter(Boolean);
  for (const ex of extras) {
    for (const part of ex.split(/\s*(?:,|&|\+|\/|\band\b|\bи\b)\s*/i)) {
      const p = part.trim();
      if (p.length >= 2 && !list.some((existing) => existing.toLowerCase() === p.toLowerCase())) {
        list.push(p);
      }
    }
  }
  return list.join(', ');
}

export function normalizeTrack(raw: Track): Track {
  if (!raw || !raw.title) return raw;
  let title = stripInvisibleAndZalgo(raw.title);
  const featured: string[] = [];

  for (const rx of SPAM_PATTERNS) {
    title = title.replace(rx, ' ');
  }
  title = title.replace(FEAT_PAREN_RE, (_m, inner: string) => {
    featured.push(inner.trim());
    return ' ';
  });
  const tailFeat = title.match(FEAT_TAIL_RE);
  if (tailFeat) {
    featured.push(tailFeat[1].trim());
    title = title.slice(0, tailFeat.index).trim();
  }
  title = title.replace(/\s{2,}/g, ' ').trim();

  const lower = title.toLowerCase();
  let badge: string | undefined = raw.badge;
  if (!badge) {
    if (/slowed|reverb|s\s*\+\s*r/.test(lower)) badge = 'Slowed';
    else if (/speed\s*up|sped\s*up|nightcore/.test(lower)) badge = 'Speed Up';
    else if (/\bremix\b|\bflip\b|\bvip\b|\bbootleg\b/.test(lower)) badge = 'Remix';
  }

  let artist = stripInvisibleAndZalgo(raw.publisher_metadata?.artist || raw.user?.username || '')
    .replace(/#\S+|\.(mp3|wav|flac)$/gi, '')
    .replace(/^@/, '')
    .trim();
  const uploaderNorm = (raw.user?.username ?? '').toLowerCase();

  const sepNorm = title.replace(/\s*\|\|\s*|\s+[—–-]\s+/g, ' - ');
  const sepMatch = sepNorm.match(/^(.{2,44}?)\s+-\s+(.{2,90})$/);
  if (sepMatch) {
    const left = sepMatch[1].trim();
    const right = sepMatch[2].trim();
    const leftNorm = left.toLowerCase();
    const rightNorm = right.toLowerCase();

    if (leftNorm === uploaderNorm || (uploaderNorm.length >= 3 && uploaderNorm.includes(leftNorm))) {
      artist = left;
      title = right;
    } else if (rightNorm === uploaderNorm || (uploaderNorm.length >= 3 && uploaderNorm.includes(rightNorm))) {
      artist = right;
      title = left;
    } else if (!raw.publisher_metadata?.artist) {

      const looksTrackDashArtist = left.includes(' ') && !right.includes(' ') && right.length <= 16;
      if (looksTrackDashArtist) {
        artist = right;
        title = left;
      } else {
        artist = left;
        title = right;
      }
    }
  }

  if (featured.length > 0) {
    artist = appendUniqueArtists(artist, featured);
  }

  title = title.replace(/^[-–—•|]+\s*|\s*[-–—•|]+$/g, '').trim() || raw.title;

  return {
    ...raw,
    title,
    badge,
    user: raw.user ? { ...raw.user, username: artist || raw.user.username } : raw.user
  };
}

const REMIX_TITLE_RE =
  /\b(remix|ремикс|slowed|reverb|s\s*\+\s*r|speed\s*up|sped\s*up|nightcore|bass\s*boosted|hoodtrap|jerk|pluggn|mashup|bootleg|flip|vip|8d\s*audio|instrumental\s*version)\b/i;

export function isRemixTrack(t: Track): boolean {
  if (!t) return false;
  if (t.badge && /^(Remix|Slowed|Speed Up)$/i.test(t.badge)) return true;
  const hay = `${t.title ?? ''} ${t.genre ?? ''} ${t.tag_list ?? ''}`;
  return REMIX_TITLE_RE.test(hay);
}

export function filterTracks(
  tracks: Track[],
  opts: { hideDuplicates?: boolean; hideRemixes?: boolean } = {}
): Track[] {
  const hideDuplicates = opts.hideDuplicates ?? true;
  const hideRemixes = opts.hideRemixes ?? false;
  const seenIds = new Set<number>();
  const seenKeys = new Set<string>();
  const out: Track[] = [];

  for (const raw of tracks) {
    if (!raw?.id || seenIds.has(raw.id)) continue;
    const t = normalizeTrack(raw);
    if (hideRemixes && isRemixTrack(t)) continue;
    if (hideDuplicates) {
      const cleanTitle = t.title.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
      const artist = (t.user?.username ?? '').toLowerCase().trim();
      const durBucket = Math.round((t.duration ?? 0) / 15_000);
      const key = `${artist}::${cleanTitle}#${durBucket}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
    }
    seenIds.add(t.id);
    out.push(t);
  }
  return out;
}

export function shuffled<T>(arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let h: ReturnType<typeof setTimeout> | undefined;
  return (...a: A) => {
    clearTimeout(h);
    h = setTimeout(() => fn(...a), ms);
  };
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
