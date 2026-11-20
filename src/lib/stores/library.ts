import { get, writable } from 'svelte/store';
import { ArimaError, ipc, isTauri, userMessage } from '$lib/api/arima';
import { sc } from '$lib/api/soundcloud';
import { auth } from '$lib/stores/auth';
import type { Playlist, Track } from '$lib/types';

const MAX_LIKES = 2000;

export const likedTracks = writable<Track[]>([]);
export const likedIds = writable<Set<number>>(new Set());
export const likesStatus = writable<{ loading: boolean; error: string | null; done: boolean }>({
  loading: false,
  error: null,
  done: false
});

export const myPlaylists = writable<Playlist[]>([]);
export const likedPlaylists = writable<Playlist[]>([]);
export const playlistsStatus = writable<{ loading: boolean; error: string | null }>({
  loading: false,
  error: null
});

let likesSeq = 0;

export async function loadLikes(force = false): Promise<void> {
  const st = get(likesStatus);
  if (st.loading || (st.done && !force)) return;
  const seq = ++likesSeq;
  likesStatus.set({ loading: true, error: null, done: false });
  likedTracks.set([]);
  likedIds.set(new Set());
  try {
    let page = await sc.likes(100);
    let all: Track[] = [];
    for (;;) {
      if (seq !== likesSeq) return;
      all = all.concat(page.items.filter((t) => t.title));
      likedTracks.set(all);
      likedIds.set(new Set(all.map((t) => t.id)));
      if (!page.next || all.length >= MAX_LIKES) break;
      page = await sc.nextLikes(page.next);
    }
    likesStatus.set({ loading: false, error: null, done: true });
  } catch (e) {
    likesStatus.set({ loading: false, error: userMessage(e), done: false });
  }
}

export async function toggleLike(track: Track): Promise<void> {
  const liked = get(likedIds).has(track.id);
  applyLike(track, !liked);
  try {
    await sc.setTrackLike(track.id, !liked);
  } catch (e) {
    const blocked = e instanceof ArimaError && e.kind === 'forbidden';
    const uid = get(auth).user?.id;
    if (blocked && isTauri && uid) {
      try {

        await ipc.app.likeViaWebview(track.id, uid, !liked);
        return;
      } catch (retryErr) {
        applyLike(track, liked);
        throw retryErr;
      }
    }
    applyLike(track, liked);
    throw e;
  }
}

function applyLike(track: Track, liked: boolean): void {
  likedIds.update((s) => {
    const n = new Set(s);
    if (liked) n.add(track.id);
    else n.delete(track.id);
    return n;
  });
  likedTracks.update((l) =>
    liked ? [track, ...l.filter((t) => t.id !== track.id)] : l.filter((t) => t.id !== track.id)
  );
}

export async function loadPlaylists(): Promise<void> {
  playlistsStatus.set({ loading: true, error: null });
  try {
    const [mine, liked] = await Promise.all([sc.myPlaylists(), sc.likedPlaylists()]);
    myPlaylists.set(mine);
    likedPlaylists.set(liked);
    playlistsStatus.set({ loading: false, error: null });
  } catch (e) {
    playlistsStatus.set({ loading: false, error: userMessage(e) });
  }
}

export function resetLibrary(): void {
  likesSeq++;
  likedTracks.set([]);
  likedIds.set(new Set());
  likesStatus.set({ loading: false, error: null, done: false });
  myPlaylists.set([]);
  likedPlaylists.set([]);
}
