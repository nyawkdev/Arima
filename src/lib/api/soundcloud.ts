import { get } from 'svelte/store';
import { ipc } from '$lib/api/arima';
import { auth } from '$lib/stores/auth';
import { isPlayable, normalizeTrack } from '$lib/utils';
import type { Collection, Page, Playlist, ScUser, Track, Transcoding } from '$lib/types';

export interface ResolvedStream {
  url: string;
  protocol: 'hls' | 'progressive';
}

function myId(): number {
  const u = get(auth).user;
  if (!u) throw new Error('Требуется вход в аккаунт SoundCloud.');
  return u.id;
}

function toPage<T>(c: Collection<T>): Page<T> {
  return { items: c.collection ?? [], next: c.next_href ?? null };
}

export function sortTranscodings(list: Transcoding[]): Transcoding[] {
  const rank = (t: Transcoding): number => {
    const mime = t.format.mime_type;
    const hls = t.format.protocol === 'hls';
    let r = 0;
    if (t.snipped) r += 100;
    if (!hls && mime.includes('mpeg')) r += 0;
    else if (hls && mime.includes('mp4')) r += 1;
    else if (hls && mime.includes('mpeg')) r += 2;
    else if (hls && mime.includes('opus')) r += 3;
    else r += 9;
    return r;
  };
  return [...list].sort((a, b) => rank(a) - rank(b));
}

export function pickTranscoding(list: Transcoding[]): Transcoding | undefined {
  return sortTranscodings(list)[0];
}

class SoundCloudApi {
  private get<T>(url: string, query?: Record<string, string | number | undefined>): Promise<T> {
    const q: Record<string, string> = {};
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) q[k] = String(v);
    return ipc.sc.request<T>({ url, query: q });
  }

  async next<T>(href: string): Promise<Page<T>> {
    return toPage(await this.get<Collection<T>>(href));
  }

  me(): Promise<ScUser> {
    return this.get<ScUser>('/me');
  }

  user(id: number | string): Promise<ScUser> {
    return this.get<ScUser>(`/users/${id}`);
  }

  async userTracks(id: number | string, limit = 50): Promise<Page<Track>> {
    let page = toPage(
      await this.get<Collection<Track>>(`/users/${id}/tracks`, { limit, linked_partitioning: 1 })
    );
    const items: Track[] = [...page.items];

    let hops = 0;
    while (page.next && items.length < limit && hops < 6) {
      hops++;
      page = await this.next<Track>(page.next);
      items.push(...page.items);
    }
    const seen = new Set<number>();
    const filtered = items
      .filter((t) => {
        if (!t?.id || seen.has(t.id) || !isPlayable(t)) return false;
        seen.add(t.id);
        return true;
      })
      .map(normalizeTrack);
    return { items: filtered, next: page.next };
  }

  async userPlaylists(id: number | string, limit = 20): Promise<Playlist[]> {
    const c = await this.get<Collection<Playlist>>(`/users/${id}/playlists_without_albums`, {
      limit,
      linked_partitioning: 1
    });
    return c.collection ?? [];
  }

  async userAlbums(id: number | string, limit = 20): Promise<Playlist[]> {
    const c = await this.get<Collection<Playlist>>(`/users/${id}/albums`, {
      limit,
      linked_partitioning: 1
    });
    return c.collection ?? [];
  }

  async userReposts(id: number | string, limit = 30): Promise<Track[]> {
    const c = await this.get<Collection<{ track?: Track }>>(`/stream/users/${id}/reposts`, {
      limit,
      linked_partitioning: 1
    });
    return c.collection
      .map((x) => x.track)
      .filter((t): t is Track => !!t?.id && !!t?.title && isPlayable(t))
      .map(normalizeTrack);
  }

  async userLikes(id: number | string, limit = 30): Promise<Track[]> {
    const c = await this.get<Collection<{ track?: Track }>>(`/users/${id}/track_likes`, {
      limit,
      linked_partitioning: 1
    });
    return c.collection
      .map((x) => x.track)
      .filter((t): t is Track => !!t?.id && !!t?.title && isPlayable(t))
      .map(normalizeTrack);
  }

  async track(id: number): Promise<Track> {
    return normalizeTrack(await this.get<Track>(`/tracks/${id}`));
  }

  async hydrate(tracks: Track[]): Promise<Track[]> {
    const stubs = tracks.filter((t) => !t.title).map((t) => t.id);
    if (stubs.length === 0) return tracks.filter(isPlayable).map(normalizeTrack);
    const full = new Map<number, Track>();
    for (let i = 0; i < stubs.length; i += 40) {
      const ids = stubs.slice(i, i + 40).join(',');
      const part = await this.get<Track[]>('/tracks', { ids });
      for (const t of part) full.set(t.id, t);
    }
    return tracks
      .map((t) => full.get(t.id) ?? t)
      .filter((t) => !!t.title && isPlayable(t))
      .map(normalizeTrack);
  }

  async likes(limit = 50): Promise<Page<Track>> {
    const c = await this.get<Collection<{ track: Track }>>(`/users/${myId()}/track_likes`, {
      limit,
      linked_partitioning: 1
    });
    return {
      items: c.collection
        .map((x) => x.track)
        .filter((t) => !!t && isPlayable(t))
        .map(normalizeTrack),
      next: c.next_href
    };
  }

  async nextLikes(href: string): Promise<Page<Track>> {
    const c = await this.get<Collection<{ track: Track }>>(href);
    return {
      items: c.collection
        .map((x) => x.track)
        .filter((t) => !!t && isPlayable(t))
        .map(normalizeTrack),
      next: c.next_href
    };
  }

  async myPlaylists(limit = 50): Promise<Playlist[]> {
    const c = await this.get<Collection<Playlist>>(`/users/${myId()}/playlists_without_albums`, {
      limit,
      linked_partitioning: 1
    });
    return c.collection;
  }

  async likedPlaylists(limit = 50): Promise<Playlist[]> {
    const c = await this.get<Collection<{ playlist: Playlist }>>(
      `/users/${myId()}/playlist_likes`,
      { limit, linked_partitioning: 1 }
    );
    return c.collection.map((x) => x.playlist).filter(Boolean);
  }

  async playlist(id: number | string): Promise<Playlist> {
    const p = await this.get<Playlist>(`/playlists/${id}`);
    p.tracks = await this.hydrate(p.tracks ?? []);
    return p;
  }

  async searchTracks(q: string, limit = 30, offset = 0): Promise<Page<Track>> {
    const query: Record<string, string | number> = { q, limit, linked_partitioning: 1 };
    if (offset > 0) query.offset = offset;
    try {
      const p = toPage(await this.get<Collection<Track>>('/search/tracks', query));
      return { items: p.items.filter(isPlayable).map(normalizeTrack), next: p.next };
    } catch (err) {

      const fallback = toPage(
        await this.get<Collection<Track & { kind?: string }>>('/search', {
          q,
          limit: Math.min(50, limit + 10),
          linked_partitioning: 1
        })
      );
      const tracks = fallback.items
        .filter((x) => (!x.kind || x.kind === 'track') && isPlayable(x))
        .map(normalizeTrack)
        .slice(0, limit);
      if (!tracks.length && fallback.items.length === 0) {
        return { items: [], next: null };
      }
      if (tracks.length > 0) {
        return { items: tracks, next: fallback.next };
      }

      const cleanQ = q.replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim();
      if (cleanQ && cleanQ !== q) {
        try {
          const cleanPage = toPage(
            await this.get<Collection<Track>>('/search/tracks', { q: cleanQ, limit: Math.min(20, limit) })
          );
          if (cleanPage.items.length > 0) {
            return { items: cleanPage.items.filter(isPlayable).map(normalizeTrack), next: cleanPage.next };
          }
        } catch {

        }
      }

      const webPage = toPage(await ipc.sc.webSearch<Collection<Track>>(q, 'tracks'));
      if (webPage.items.length > 0 || !err) {
        return { items: webPage.items.filter(isPlayable).map(normalizeTrack), next: null };
      }
      throw err;
    }
  }

  async searchPlaylists(q: string, limit = 20): Promise<Page<Playlist>> {
    try {
      return toPage(
        await this.get<Collection<Playlist>>('/search/playlists', { q, limit, linked_partitioning: 1 })
      );
    } catch {
      const fallback = toPage(
        await this.get<Collection<Playlist & { kind?: string }>>('/search', {
          q,
          limit: Math.min(50, limit + 10),
          linked_partitioning: 1
        })
      );
      return {
        items: fallback.items.filter((x) => x.kind === 'playlist').slice(0, limit),
        next: fallback.next
      };
    }
  }

  async searchAlbums(q: string, limit = 20): Promise<Page<Playlist>> {
    try {
      return toPage(
        await this.get<Collection<Playlist>>('/search/albums', { q, limit, linked_partitioning: 1 })
      );
    } catch {
      const fallback = toPage(
        await this.get<Collection<Playlist & { kind?: string; is_album?: boolean }>>('/search', {
          q,
          limit: Math.min(50, limit + 10),
          linked_partitioning: 1
        })
      );
      return {
        items: fallback.items.filter((x) => x.kind === 'playlist' && x.is_album).slice(0, limit),
        next: fallback.next
      };
    }
  }

  async searchUsers(q: string, limit = 20): Promise<Page<ScUser>> {
    try {
      return toPage(
        await this.get<Collection<ScUser>>('/search/users', { q, limit, linked_partitioning: 1 })
      );
    } catch {
      const fallback = toPage(
        await this.get<Collection<ScUser & { kind?: string }>>('/search', {
          q,
          limit: Math.min(50, limit + 10),
          linked_partitioning: 1
        })
      );
      return {
        items: fallback.items.filter((x) => x.kind === 'user').slice(0, limit),
        next: fallback.next
      };
    }
  }

  resolve(url: string): Promise<Track | Playlist> {
    return this.get<Track | Playlist>('/resolve', { url });
  }

  async charts(kind: 'top' | 'trending' = 'top', genre = 'all-music', limit = 24): Promise<Track[]> {
    const shortGenre = genre.replace('soundcloud:genres:', '');
    let seeds: string[] = [];
    if (shortGenre !== 'all-music') {
      seeds = [shortGenre];
    } else {
      const taste = await ipc.history.taste().catch(() => null);
      const topUserGenres = taste
        ? Object.entries(taste.genres)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([g]) => g)
            .filter(Boolean)
        : [];
      seeds = topUserGenres.length >= 2 ? topUserGenres : ['phonk', 'electronic', 'hip-hop', 'synthwave'];
    }

    const pages = await Promise.all(
      seeds.map((g) => this.searchTracks(g, Math.ceil(limit / seeds.length) + 12).catch(() => ({ items: [], next: null })))
    );
    const raw = pages.flatMap((p) => p.items);
    const seen = new Set<number>();
    const junkRx = /\b(podcast|episode|mix\s*\d|compilation|dj\s*set|full\s*album|sample\s*pack|loop\s*kit|type\s*beat)\b/i;

    const list = raw.filter((t) => {
      if (!t?.id || !t?.title || seen.has(t.id)) return false;
      if (t.duration > 8 * 60_000 || junkRx.test(t.title)) return false;
      seen.add(t.id);
      return true;
    });

    if (kind === 'top') {
      list.sort((a, b) => (b.likes_count ?? 0) * 8 + (b.playback_count ?? 0) - ((a.likes_count ?? 0) * 8 + (a.playback_count ?? 0)));
    } else {
      list.sort((a, b) => {
        const ratioA = (a.likes_count ?? 1) / Math.max(100, a.playback_count ?? 100);
        const ratioB = (b.likes_count ?? 1) / Math.max(100, b.playback_count ?? 100);
        return ratioB - ratioA;
      });
    }
    return list.slice(0, limit);
  }

  async releases(limit = 20): Promise<Track[]> {
    const taste = await ipc.history.taste().catch(() => null);
    const topGenres = taste
      ? Object.entries(taste.genres)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([g]) => g)
          .filter(Boolean)
      : [];
    const seeds = topGenres.length ? topGenres : ['electronic', 'phonk', 'indie', 'ambient'];
    const pages = await Promise.all(
      seeds.map((g) => this.searchTracks(g, 16).catch(() => ({ items: [], next: null })))
    );
    const seen = new Set<number>();
    const junkRx = /\b(podcast|episode|mix\s*\d|compilation|dj\s*set|sample\s*pack|loop\s*kit|type\s*beat)\b/i;

    return pages
      .flatMap((p) => p.items)
      .filter((t) => {
        if (!t?.id || !t?.title || seen.has(t.id)) return false;
        if (t.duration > 7 * 60_000 || junkRx.test(t.title)) return false;
        seen.add(t.id);
        return true;
      })
      .sort((a, b) => Date.parse(b.created_at ?? '') - Date.parse(a.created_at ?? ''))
      .slice(0, limit);
  }

  async related(id: number, limit = 20): Promise<Track[]> {
    const c = await this.get<Collection<Track>>(`/tracks/${id}/related`, { limit });
    return (c.collection ?? []).filter(isPlayable).map(normalizeTrack);
  }

  async playHistory(limit = 30): Promise<Track[]> {
    const c = await this.get<Collection<{ track: Track }>>('/me/play-history/tracks', {
      limit,
      linked_partitioning: 1
    });
    return c.collection
      .map((x) => x.track)
      .filter((t): t is Track => !!t && isPlayable(t))
      .map(normalizeTrack);
  }

  async setTrackLike(id: number, liked: boolean): Promise<void> {
    const method = liked ? 'PUT' : 'DELETE';
    let uid = myId();
    if (!uid) {
      const me = await this.me();
      uid = me.id;
    }
    await ipc.sc.request({
      method,
      url: `/users/${uid}/track_likes/${id}`
    });
  }

  async setPlaylistLike(id: number | string, liked: boolean): Promise<void> {
    await ipc.sc.request({
      method: liked ? 'PUT' : 'DELETE',
      url: `/users/${myId()}/playlist_likes/${id}`
    });
  }

  async createPlaylist(title: string, trackIds: number[], isPublic = false): Promise<Playlist> {
    return ipc.sc.request<Playlist>({
      method: 'POST',
      url: '/playlists',
      body: { playlist: { title, sharing: isPublic ? 'public' : 'private', tracks: trackIds } }
    });
  }

  private async playlistTrackIds(id: number | string): Promise<number[]> {
    const p = await this.get<Playlist>(`/playlists/${id}`);
    return (p.tracks ?? []).map((t) => t.id);
  }

  async setPlaylistTracks(id: number | string, ids: number[]): Promise<void> {
    await ipc.sc.request({
      method: 'PUT',
      url: `/playlists/${id}`,
      body: { playlist: { tracks: ids } }
    });
  }

  async addToPlaylist(id: number | string, trackId: number): Promise<void> {
    const ids = await this.playlistTrackIds(id);
    if (ids.includes(trackId)) return;
    await this.setPlaylistTracks(id, [...ids, trackId]);
  }

  async removeFromPlaylist(id: number | string, trackId: number): Promise<void> {
    const ids = await this.playlistTrackIds(id);
    await this.setPlaylistTracks(
      id,
      ids.filter((x) => x !== trackId)
    );
  }

  async deletePlaylist(id: number | string): Promise<void> {
    await ipc.sc.request({ method: 'DELETE', url: `/playlists/${id}` });
  }

  async resolveStream(track: Track): Promise<ResolvedStream> {
    const tryFrom = async (t: Track): Promise<ResolvedStream | null> => {
      const candidates = sortTranscodings((t.media?.transcodings ?? []).filter((tc) => !tc.snipped));
      for (const tc of candidates) {
        try {
          const url = await ipc.sc.resolveStream(tc.url, t.track_authorization);
          return { url, protocol: tc.format.protocol };
        } catch {

        }
      }
      return null;
    };

    if (track.media?.transcodings?.length && track.track_authorization) {
      const hit = await tryFrom(track);
      if (hit) return hit;
    }
    const fresh = await this.track(track.id).catch(() => null);
    if (fresh) {
      const hit = await tryFrom(fresh);
      if (hit) return hit;
    }

    const clean = normalizeTrack(track);
    const mirrorQuery = `${clean.user?.username ?? ''} ${clean.title}`.trim();
    if (mirrorQuery.length >= 3) {
      const alts = await this.searchTracks(mirrorQuery, 8).catch(() => ({ items: [], next: null }));
      for (const alt of alts.items) {
        if (alt.id === track.id || alt.duration < 55_000) continue;
        const hit = await tryFrom(alt);
        if (hit) return hit;
      }
    }

    throw new Error('Для этого трека нет доступного потока.');
  }
}

export const sc = new SoundCloudApi();
