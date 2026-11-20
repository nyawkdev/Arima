<script lang="ts">  import { goto } from '$app/navigation';
  import { ipc, userMessage } from '$lib/api/arima';
  import { sc } from '$lib/api/soundcloud';
  import { aiExpandQuery, rerankTracks } from '$lib/recommend/ai_search';
  import Button from '$lib/components/ui/Button.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import Loader from '$lib/components/ui/Loader.svelte';
  import PlaylistCard from '$lib/components/ui/PlaylistCard.svelte';
  import TrackList from '$lib/components/ui/TrackList.svelte';
  import { lang } from '$lib/i18n';
  import { playerActions } from '$lib/stores/player';
  import { settings } from '$lib/stores/settings';
  import { say } from '$lib/stores/ui';
  import type { Playlist, ScUser, Track } from '$lib/types';
  import { artwork, filterTracks, formatCount, isPlayable } from '$lib/utils';

  let query = $state('');
  let tab = $state<'all' | 'tracks' | 'albums' | 'playlists' | 'users'>('all');
  let loading = $state(false);
  let tracks = $state<Track[]>([]);
  let albums = $state<Playlist[]>([]);
  let playlists = $state<Playlist[]>([]);
  let users = $state<ScUser[]>([]);
  let nextHref = $state<string | null>(null);
  let error = $state<string | null>(null);
  let aiNote = $state<string | null>(null);
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const q = query.trim();
    clearTimeout(debounceTimer);
    if (!q || q.startsWith('http')) return;
    debounceTimer = setTimeout(() => {
      void search();
    }, 420);
    return () => clearTimeout(debounceTimer);
  });

  async function search(e?: SubmitEvent) {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;

    if (q.startsWith('https://soundcloud.com/') || q.startsWith('http://soundcloud.com/')) {
      loading = true;
      error = null;
      try {
        const res = await sc.resolve(q);
        if ('tracks' in res || 'track_count' in res) {
          await goto(`/playlist/${res.id}`);
        } else {
          await playerActions.playQueue([res as Track]);
        }
      } catch (err) {
        error = userMessage(err);
      } finally {
        loading = false;
      }
      return;
    }

    loading = true;
    error = null;
    const expanded = aiExpandQuery(q);
    aiNote = expanded.note;
    const searchQ = expanded.query;
    const taste = await ipc.history.taste().catch(() => null);
    try {
      if (tab === 'all') {
        const [tr, us, al, pl] = await Promise.all([
          sc.searchTracks(searchQ, 24),
          sc.searchUsers(searchQ, 8).catch(() => ({ items: [], next: null })),
          sc.searchAlbums(searchQ, 8).catch(() => ({ items: [], next: null })),
          sc.searchPlaylists(searchQ, 8).catch(() => ({ items: [], next: null }))
        ]);
        const fOpts = { hideDuplicates: $settings.ui?.hideDuplicates ?? true, hideRemixes: $settings.ui?.hideRemixes ?? false };
        tracks = filterTracks(rerankTracks(tr.items, searchQ, taste), fOpts);
        users = us.items;
        albums = al.items;
        playlists = pl.items;
        nextHref = tr.next;
      } else if (tab === 'tracks') {
        const page = await sc.searchTracks(searchQ, 30);
        const fOpts = { hideDuplicates: $settings.ui?.hideDuplicates ?? true, hideRemixes: $settings.ui?.hideRemixes ?? false };
        tracks = filterTracks(rerankTracks(page.items, searchQ, taste), fOpts);
        nextHref = page.next;
      } else if (tab === 'albums') {
        const page = await sc.searchAlbums(searchQ, 24);
        albums = page.items;
        nextHref = page.next;
      } else if (tab === 'playlists') {
        const page = await sc.searchPlaylists(searchQ, 24);
        playlists = page.items;
        nextHref = page.next;
      } else {
        const page = await sc.searchUsers(searchQ, 24);
        users = page.items;
        nextHref = page.next;
      }
    } catch (err) {
      error = userMessage(err);
    } finally {
      loading = false;
    }
  }

  async function loadMore() {
    if (!nextHref || loading) return;
    loading = true;
    try {
      if (tab === 'all' || tab === 'tracks') {
        const page = await sc.next<Track>(nextHref);
        const fOpts = { hideDuplicates: $settings.ui?.hideDuplicates ?? true, hideRemixes: $settings.ui?.hideRemixes ?? false };
        tracks = filterTracks([...tracks, ...page.items.filter(isPlayable)], fOpts);
        nextHref = page.next;
      } else if (tab === 'users') {
        const page = await sc.next<ScUser>(nextHref);
        users = [...users, ...page.items];
        nextHref = page.next;
      } else if (tab === 'albums') {
        const page = await sc.next<Playlist>(nextHref);
        albums = [...albums, ...page.items];
        nextHref = page.next;
      } else {
        const page = await sc.next<Playlist>(nextHref);
        playlists = [...playlists, ...page.items];
        nextHref = page.next;
      }
    } catch (err) {
      say(userMessage(err));
    } finally {
      loading = false;
    }
  }

  function switchTab(next: typeof tab) {
    tab = next;
    if (query.trim()) void search();
  }
</script>

<div class="mx-auto max-w-[1600px] px-8 py-6">
  <form class="mb-6 flex gap-3" onsubmit={search}>
    <Input
      bind:value={query}
      placeholder={$lang === 'ru'
        ? 'Трек, альбом, артист, плейлист или ссылка soundcloud.com...'
        : 'Track, album, artist, playlist or soundcloud.com URL...'}
      class="flex-1"
    />
    <Button type="submit" variant="solid" disabled={loading || !query.trim()}>
      {$lang === 'ru' ? 'Найти' : 'Search'}
    </Button>
  </form>

  <div class="mb-6 flex flex-wrap gap-2 text-[13px] font-medium">
    {#each [
      ['all', $lang === 'ru' ? 'Всё' : 'All'],
      ['tracks', $lang === 'ru' ? 'Треки' : 'Tracks'],
      ['albums', $lang === 'ru' ? 'Альбомы' : 'Albums'],
      ['playlists', $lang === 'ru' ? 'Плейлисты' : 'Playlists'],
      ['users', $lang === 'ru' ? 'Артисты' : 'Artists']
    ] as [id, label] (id)}
      <button
        style={tab === id ? 'color:#000000' : ''}
        class="rounded-full px-4 py-1.5 transition-all duration-150 {tab === id
          ? 'bg-pure-white text-pure-black font-semibold'
          : 'bg-pure-white/[0.04] text-dim hover:bg-pure-white/[0.08] hover:text-pure-white'}"
        onclick={() => switchTab(id as typeof tab)}
      >
        {label}
      </button>
    {/each}
  </div>

  {#if aiNote}
    <div class="mb-4 text-[12px] text-dim">{aiNote}</div>
  {/if}

  {#if loading}
    <Loader />
  {/if}

  {#if error}
    <div class="glass-panel rounded-2xl p-4 text-[13px] text-dim">{error}</div>
  {:else if tab === 'all'}
    {#if tracks.length || users.length || albums.length || playlists.length}
      <div class="grid grid-cols-1 gap-6 lg:grid-cols-[440px_minmax(0,1fr)]">
        <div class="space-y-6">
          {#if users.length}
            <section class="glass-panel rounded-3xl p-5">
              <h2 class="mb-3 text-[14px] font-semibold text-pure-white">{$lang === 'ru' ? 'Артисты' : 'Artists'}</h2>
              <div class="space-y-2">
                {#each users.slice(0, 4) as u (u.id)}
                  <a
                    href="/artist/{u.id}"
                    class="flex items-center gap-3.5 rounded-2xl p-2 transition-colors hover:bg-hover"
                  >
                    <div class="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-surface">
                      {#if u.avatar_url}
                        <img src={artwork(u.avatar_url, 't120x120')} alt="" class="h-full w-full object-cover" loading="lazy" />
                      {/if}
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-[14px] font-semibold text-pure-white">{u.full_name || u.username}</div>
                      {#if u.followers_count !== undefined}
                        <div class="text-[12px] text-dim">
                          {formatCount(u.followers_count)} {$lang === 'ru' ? 'подписчиков' : 'followers'}
                        </div>
                      {/if}
                    </div>
                  </a>
                {/each}
              </div>
            </section>
          {/if}

          {#if albums.length || playlists.length}
            <section class="glass-panel rounded-3xl p-5">
              <h2 class="mb-3 text-[14px] font-semibold text-pure-white">
                {$lang === 'ru' ? 'Альбомы и плейлисты' : 'Albums & playlists'}
              </h2>
              <div class="grid grid-cols-2 gap-3">
                {#each [...albums.slice(0, 2), ...playlists.slice(0, 2)] as pl (pl.id)}
                  <PlaylistCard playlist={pl} href={`/playlist/${pl.id}`} />
                {/each}
              </div>
            </section>
          {/if}
        </div>

        <section class="glass-panel rounded-3xl p-5">
          <h2 class="mb-3 px-2 text-[14px] font-semibold text-pure-white">{$lang === 'ru' ? 'Треки' : 'Tracks'}</h2>
          {#if tracks.length}
            <TrackList {tracks} showPlays />
            {#if nextHref}
              <div class="mt-4 flex justify-center">
                <Button onclick={loadMore}>{$lang === 'ru' ? 'Ещё' : 'Load more'}</Button>
              </div>
            {/if}
          {:else}
            <div class="py-8 text-center text-[13px] text-dim">
              {$lang === 'ru' ? 'Треки не найдены' : 'No tracks found'}
            </div>
          {/if}
        </section>
      </div>
    {:else if !loading}
      <div class="py-12 text-center text-[13px] text-dim">
        {$lang === 'ru' ? 'Введите запрос или вставьте ссылку SoundCloud' : 'Enter a query or paste a SoundCloud URL'}
      </div>
    {/if}
  {:else if tab === 'tracks'}
    {#if tracks.length}
      <div class="glass-panel rounded-3xl p-5">
        <TrackList {tracks} showPlays />
      </div>
      {#if nextHref}
        <div class="mt-6 flex justify-center">
          <Button onclick={loadMore}>{$lang === 'ru' ? 'Ещё' : 'Load more'}</Button>
        </div>
      {/if}
    {:else if !loading}
      <div class="py-12 text-center text-[13px] text-dim">
        {$lang === 'ru' ? 'Треки не найдены' : 'No tracks found'}
      </div>
    {/if}
  {:else if tab === 'users'}
    {#if users.length}
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {#each users as u (u.id)}
          <a
            href="/artist/{u.id}"
            class="glass-panel group flex flex-col items-center rounded-2xl p-4 text-center transition-all duration-200 hover:-translate-y-0.5"
          >
            <div class="h-28 w-28 overflow-hidden rounded-full bg-surface">
              {#if u.avatar_url}
                <img src={artwork(u.avatar_url, 't300x300')} alt="" class="h-full w-full object-cover" loading="lazy" draggable="false" />
              {/if}
            </div>
            <div class="mt-3 w-full truncate text-[13px] font-medium text-pure-white">
              {u.full_name || u.username}
            </div>
            {#if u.followers_count !== undefined}
              <div class="text-[12px] text-dim">
                {formatCount(u.followers_count)} {$lang === 'ru' ? 'подписчиков' : 'followers'}
              </div>
            {/if}
          </a>
        {/each}
      </div>
      {#if nextHref}
        <div class="mt-6 flex justify-center">
          <Button onclick={loadMore}>{$lang === 'ru' ? 'Ещё' : 'Load more'}</Button>
        </div>
      {/if}
    {:else if !loading}
      <div class="py-12 text-center text-[13px] text-dim">
        {$lang === 'ru' ? 'Ничего не найдено' : 'Nothing found'}
      </div>
    {/if}
  {:else}
    {@const list = tab === 'albums' ? albums : playlists}
    {#if list.length}
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {#each list as pl (pl.id)}
          <PlaylistCard playlist={pl} href={`/playlist/${pl.id}`} />
        {/each}
      </div>
      {#if nextHref}
        <div class="mt-6 flex justify-center">
          <Button onclick={loadMore}>{$lang === 'ru' ? 'Ещё' : 'Load more'}</Button>
        </div>
      {/if}
    {:else if !loading}
      <div class="py-12 text-center text-[13px] text-dim">
        {$lang === 'ru' ? 'Ничего не найдено' : 'Nothing found'}
      </div>
    {/if}
  {/if}
</div>
