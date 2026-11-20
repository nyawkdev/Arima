<script lang="ts">  import { page } from '$app/state';
  import { userMessage } from '$lib/api/arima';
  import { sc } from '$lib/api/soundcloud';
  import Button from '$lib/components/ui/Button.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import Loader from '$lib/components/ui/Loader.svelte';
  import PlaylistCard from '$lib/components/ui/PlaylistCard.svelte';
  import TrackList from '$lib/components/ui/TrackList.svelte';
  import { lang, tr } from '$lib/i18n';
  import { startWaveFromTracks } from '$lib/recommend/engine';
  import { playerActions } from '$lib/stores/player';
  import { say } from '$lib/stores/ui';
  import type { Playlist, ScUser, Track } from '$lib/types';
  import { artwork, formatCount, isPlayable } from '$lib/utils';

  let artist = $state<ScUser | null>(null);
  let tracks = $state<Track[]>([]);
  let tracksNext = $state<string | null>(null);
  let loadingMore = $state(false);
  let albums = $state<Playlist[]>([]);
  let playlists = $state<Playlist[]>([]);
  let reposts = $state<Track[]>([]);
  let likes = $state<Track[]>([]);
  let tab = $state<'tracks' | 'albums' | 'playlists' | 'reposts' | 'likes'>('tracks');
  let loading = $state(true);
  let error = $state<string | null>(null);

  const id = $derived(page.params.id ?? '');

  $effect(() => {
    const curId = id;
    if (!curId) return;
    loading = true;
    error = null;
    tab = 'tracks';
    void Promise.all([
      sc.user(curId),
      sc.userTracks(curId, 60),
      sc.userAlbums(curId, 20).catch(() => [] as Playlist[]),
      sc.userPlaylists(curId, 20).catch(() => [] as Playlist[]),
      sc.userReposts(curId, 30).catch(() => [] as Track[]),
      sc.userLikes(curId, 30).catch(() => [] as Track[])
    ])
      .then(([u, tr, alb, pl, rep, lk]) => {
        artist = u;
        tracks = tr.items;
        tracksNext = tr.next;
        albums = alb;
        playlists = pl;
        reposts = rep;
        likes = lk;
      })
      .catch((e) => (error = userMessage(e)))
      .finally(() => (loading = false));
  });
  async function loadMoreTracks() {
    if (!tracksNext || loadingMore) return;
    loadingMore = true;
    try {
      const page = await sc.next<Track>(tracksNext);
      const seen = new Set(tracks.map((t) => t.id));
      tracks = [...tracks, ...page.items.filter((t) => !seen.has(t.id) && isPlayable(t))];
      tracksNext = page.next;
    } catch (e) {
      say(userMessage(e));
    } finally {
      loadingMore = false;
    }
  }
</script>

<div class="px-8 py-6">
  <button
    class="mb-6 inline-flex items-center gap-2 text-[12px] font-medium text-dim hover:text-pure-white"
    onclick={() => history.back()}
  >
    <Icon name="arrow-left" size={14} />
    <span>{$lang === 'ru' ? 'Назад' : 'Back'}</span>
  </button>

  {#if loading}
    <Loader />
  {:else if error}
    <div class="rounded-xl border border-line bg-surface p-4 text-[13px] text-dim">{error}</div>
  {:else if artist}
    <div class="relative mb-6 flex items-end gap-6 overflow-hidden rounded-2xl border border-line bg-surface p-6">
      {#if artist.avatar_url}
        <img
          src={artwork(artist.avatar_url, 't300x300')}
          alt=""
          class="pointer-events-none absolute -left-8 -top-8 h-64 w-64 rounded-full object-cover opacity-25 blur-3xl"
          draggable="false"
        />
      {/if}

      <div class="relative h-32 w-32 shrink-0 overflow-hidden rounded-full border border-line bg-pure-black">
        {#if artist.avatar_url}
          <img src={artwork(artist.avatar_url, 't300x300')} alt="" class="h-full w-full object-cover" draggable="false" />
        {/if}
      </div>

      <div class="relative min-w-0 flex-1">
        <div class="mb-1 text-[12px] text-dim">{$lang === 'ru' ? 'Артист' : 'Artist'}</div>
        <h1 class="truncate text-[28px] font-bold tracking-tight text-pure-white">
          {artist.full_name || artist.username}
        </h1>
        <div class="mt-1 text-[13px] text-dim">
          @{artist.username}
          {#if artist.followers_count !== undefined}
            · {formatCount(artist.followers_count)} {$lang === 'ru' ? 'подписчиков' : 'followers'}
          {/if}
        </div>
        <div class="mt-4 flex flex-wrap gap-3">
          <Button variant="solid" disabled={!tracks.length} onclick={() => playerActions.playQueue(tracks)}>
            <Icon name="play" size={13} />
            <span>{$lang === 'ru' ? 'Играть все' : 'Play all'}</span>
          </Button>
          <Button
            disabled={!tracks.length}
            onclick={() => void startWaveFromTracks(tracks).catch((e) => say(userMessage(e)))}
          >
            <Icon name="wave" size={14} />
            <span>{$lang === 'ru' ? 'Моя волна' : 'My wave'}</span>
          </Button>
        </div>
      </div>
    </div>

    <div class="mb-6 flex flex-wrap gap-6 border-b border-line pb-3 text-[13px] font-medium">
      {#each [
        ['tracks', `${$lang === 'ru' ? 'Треки' : 'Tracks'} (${tracks.length})`],
        ['albums', `${$lang === 'ru' ? 'Альбомы' : 'Albums'} (${albums.length})`],
        ['playlists', `${$lang === 'ru' ? 'Плейлисты' : 'Playlists'} (${playlists.length})`],
        ['reposts', `${$lang === 'ru' ? 'Репосты' : 'Reposts'} (${reposts.length})`],
        ['likes', `${$lang === 'ru' ? 'Лайки' : 'Likes'} (${likes.length})`]
      ] as [id, label] (id)}
        <button
          class={tab === id ? 'text-pure-white' : 'text-dim hover:text-pure-white'}
          onclick={() => (tab = id as typeof tab)}
        >
          {label}
        </button>
      {/each}
    </div>

    {#if tab === 'tracks'}
      {#if tracks.length}
        <TrackList {tracks} showPlays />
        {#if tracksNext}
          <div class="mt-6 flex justify-center">
            <Button disabled={loadingMore} onclick={loadMoreTracks}>
              {loadingMore
                ? ($lang === 'ru' ? 'Загрузка...' : 'Loading...')
                : ($lang === 'ru' ? 'Загрузить ещё' : 'Load more')}
            </Button>
          </div>
        {/if}
      {:else}
        <div class="py-12 text-center text-[13px] text-dim">{$lang === 'ru' ? 'Нет треков' : 'No tracks'}</div>
      {/if}
    {:else if tab === 'albums'}
      {#if albums.length}
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {#each albums as pl (pl.id)}
            <PlaylistCard playlist={pl} href={`/playlist/${pl.id}`} />
          {/each}
        </div>
      {:else}
        <div class="py-12 text-center text-[13px] text-dim">{$lang === 'ru' ? 'Нет альбомов' : 'No albums'}</div>
      {/if}
    {:else if tab === 'playlists'}
      {#if playlists.length}
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {#each playlists as pl (pl.id)}
            <PlaylistCard playlist={pl} href={`/playlist/${pl.id}`} />
          {/each}
        </div>
      {:else}
        <div class="py-12 text-center text-[13px] text-dim">{$lang === 'ru' ? 'Нет плейлистов' : 'No playlists'}</div>
      {/if}
    {:else if tab === 'reposts'}
      {#if reposts.length}
        <TrackList tracks={reposts} />
      {:else}
        <div class="py-12 text-center text-[13px] text-dim">{$lang === 'ru' ? 'Нет репостов' : 'No reposts'}</div>
      {/if}
    {:else if likes.length}
      <TrackList tracks={likes} />
    {:else}
      <div class="py-12 text-center text-[13px] text-dim">{$lang === 'ru' ? 'Нет лайков' : 'No likes'}</div>
    {/if}
  {/if}
</div>
