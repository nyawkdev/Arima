<script lang="ts">  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { ipc, userMessage } from '$lib/api/arima';
  import { sc } from '$lib/api/soundcloud';
  import Button from '$lib/components/ui/Button.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import Loader from '$lib/components/ui/Loader.svelte';
  import PlaylistCard from '$lib/components/ui/PlaylistCard.svelte';
  import TrackList from '$lib/components/ui/TrackList.svelte';
  import { get } from 'svelte/store';
  import { lang, plural, tr } from '$lib/i18n';
  import { auth } from '$lib/stores/auth';
  import {
    likedPlaylists,
    likedTracks,
    likesStatus,
    loadLikes,
    loadPlaylists,
    myPlaylists,
    playlistsStatus
  } from '$lib/stores/library';
  import { playerActions } from '$lib/stores/player';
  import { say } from '$lib/stores/ui';
  import type { Track } from '$lib/types';

  let tab = $state<'likes' | 'playlists' | 'history'>('likes');
  let filter = $state('');
  let showFilter = $state(false);
  let historyTracks = $state<Track[]>([]);
  let newPlTitle = $state('');
  let creating = $state(false);

  $effect(() => {
    const q = page.url.searchParams.get('tab');
    if (q === 'playlists') tab = 'playlists';
    else if (q === 'history') tab = 'history';
    else tab = 'likes';
  });

  $effect(() => {
    if (tab === 'playlists' && $auth.status === 'authenticated') {
      void loadPlaylists();
    } else if (tab === 'history') {
      void ipc.history
        .list(100)
        .then((r) => (historyTracks = r.map((x) => x.track)))
        .catch(() => undefined);
    }
  });

  onMount(() => {
    if ($auth.status === 'authenticated' && !$likesStatus.done && !$likesStatus.loading) {
      void loadLikes();
    }
  });

  const filteredLikes = $derived(
    filter.trim()
      ? $likedTracks.filter((tr) => {
          const q = filter.trim().toLowerCase();
          return (
            tr.title.toLowerCase().includes(q) ||
            (tr.user?.username ?? '').toLowerCase().includes(q)
          );
        })
      : $likedTracks
  );

  async function createPlaylist(e: SubmitEvent) {
    e.preventDefault();
    if (!newPlTitle.trim() || creating) return;
    creating = true;
    try {
      await sc.createPlaylist(newPlTitle.trim(), []);
      newPlTitle = '';
      await loadPlaylists();
      say(get(lang) === 'ru' ? 'Плейлист создан' : 'Playlist created');
    } catch (err) {
      say(userMessage(err));
    } finally {
      creating = false;
    }
  }
</script>

<div class="px-8 py-6">
  <div class="mb-6 flex items-end gap-6">
    <div class="flex h-32 w-32 shrink-0 items-center justify-center rounded-2xl border border-line bg-surface text-pure-white">
      <Icon
        name={tab === 'likes' ? 'heart-fill' : tab === 'playlists' ? 'playlist' : 'clock'}
        size={38}
      />
    </div>

    <div class="min-w-0 flex-1">
      <h1 class="text-[28px] font-bold tracking-tight text-pure-white">
        {tab === 'likes'
          ? $lang === 'ru' ? 'Любимые' : 'Liked'
          : tab === 'playlists'
            ? $lang === 'ru' ? 'Плейлисты' : 'Playlists'
            : $lang === 'ru' ? 'История' : 'History'}
      </h1>
      <div class="mt-0.5 text-[13px] text-dim">
        {#if tab === 'likes'}
          {$likedTracks.length} {$lang === 'ru' ? plural($likedTracks.length, 'трек', 'трека', $tr.common.tracks) : $likedTracks.length === 1 ? 'track' : 'tracks'}
        {:else if tab === 'playlists'}
          {$myPlaylists.length + $likedPlaylists.length} {$lang === 'ru' ? 'плейлистов' : 'playlists'}
        {:else}
          {historyTracks.length} {$lang === 'ru' ? plural(historyTracks.length, 'трек', 'трека', $tr.common.tracks) : historyTracks.length === 1 ? 'track' : 'tracks'}
        {/if}
      </div>

      <div class="mt-4 flex flex-wrap items-center gap-2.5">
        {#if tab === 'likes' && filteredLikes.length}
          <Button variant="solid" onclick={() => playerActions.playQueue(filteredLikes)}>
            <Icon name="play" size={13} />
            <span>{$lang === 'ru' ? 'Играть все' : 'Play all'}</span>
          </Button>
          <Button square onclick={() => (showFilter = !showFilter)} aria-label={$tr.nav.search}>
            <Icon name="search" size={14} />
          </Button>
          <Button square onclick={() => playerActions.enqueue(filteredLikes)} aria-label={$lang === 'ru' ? 'В очередь' : 'Add to queue'}>
            <Icon name="queue" size={14} />
          </Button>
        {:else if tab === 'history' && historyTracks.length}
          <Button variant="solid" onclick={() => playerActions.playQueue(historyTracks)}>
            <Icon name="play" size={13} />
            <span>{$lang === 'ru' ? 'Играть все' : 'Play all'}</span>
          </Button>
          <Button
            onclick={async () => {
              await ipc.history.clear();
              historyTracks = [];
            }}
          >
            {$lang === 'ru' ? 'Очистить историю' : 'Clear history'}
          </Button>
        {/if}
      </div>
    </div>
  </div>

  <div class="mb-4 flex gap-6 border-b border-line pb-3 text-[13px] font-medium">
    <a href="/library" class={tab === 'likes' ? 'text-pure-white' : 'text-dim hover:text-pure-white'}>
      {$lang === 'ru' ? 'Любимые' : 'Liked'}
    </a>
    <a
      href="/library?tab=playlists"
      class={tab === 'playlists' ? 'text-pure-white' : 'text-dim hover:text-pure-white'}
    >
      {$lang === 'ru' ? 'Плейлисты' : 'Playlists'}
    </a>
    <a
      href="/library?tab=history"
      class={tab === 'history' ? 'text-pure-white' : 'text-dim hover:text-pure-white'}
    >
      {$lang === 'ru' ? 'История' : 'History'}
    </a>
  </div>

  {#if $auth.status !== 'authenticated' && tab !== 'history'}
    <div class="flex items-center justify-between rounded-2xl border border-line bg-surface p-6">
      <span class="text-[13px] text-dim">
        {$lang === 'ru'
          ? 'Войдите в аккаунт SoundCloud, чтобы синхронизировать лайки и плейлисты'
          : 'Sign in to your SoundCloud account to sync likes and playlists'}
      </span>
      <a href="/login" class="rounded-full bg-pure-white px-5 py-2 text-[13px] font-medium text-pure-black">
        {$lang === 'ru' ? 'Войти' : 'Sign in'}
      </a>
    </div>
  {:else if tab === 'likes'}
    {#if showFilter}
      <div class="mb-4">
        <Input bind:value={filter} placeholder={$lang === 'ru' ? 'Поиск в любимых...' : 'Search in liked...'} />
      </div>
    {/if}
    {#if $likesStatus.loading && !$likedTracks.length}
      <Loader />
    {:else if $likesStatus.error}
      <div class="rounded-xl border border-line p-4 text-[13px] text-dim">{$likesStatus.error}</div>
    {:else}
      <TrackList tracks={filteredLikes} />
    {/if}
  {:else if tab === 'playlists'}
    <form class="mb-6 flex gap-3" onsubmit={createPlaylist}>
      <Input bind:value={newPlTitle} placeholder={$lang === 'ru' ? 'Название нового плейлиста...' : 'New playlist title...'} class="flex-1" />
      <Button type="submit" variant="solid" disabled={creating || !newPlTitle.trim()}>
        {$lang === 'ru' ? 'Создать' : 'Create'}
      </Button>
    </form>

    {#if $playlistsStatus.loading}
      <Loader />
    {:else}
      {#if $myPlaylists.length}
        <h2 class="section-title mb-3">{$lang === 'ru' ? 'Мои плейлисты' : 'My playlists'}</h2>
        <div class="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {#each $myPlaylists as pl (pl.id)}
            <PlaylistCard playlist={pl} href={`/playlist/${pl.id}`} />
          {/each}
        </div>
      {/if}

      {#if $likedPlaylists.length}
        <h2 class="section-title mb-3">{$lang === 'ru' ? 'Лайкнутые плейлисты' : 'Liked playlists'}</h2>
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {#each $likedPlaylists as pl (pl.id)}
            <PlaylistCard playlist={pl} href={`/playlist/${pl.id}`} />
          {/each}
        </div>
      {/if}
    {/if}
  {:else if historyTracks.length}
    <TrackList tracks={historyTracks} />
  {:else}
    <div class="py-12 text-center text-[13px] text-dim">
      {$lang === 'ru' ? 'История пуста' : 'History is empty'}
    </div>
  {/if}
</div>
