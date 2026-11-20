<script lang="ts">  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { userMessage } from '$lib/api/arima';
  import { sc } from '$lib/api/soundcloud';
  import Button from '$lib/components/ui/Button.svelte';
  import Cover from '$lib/components/ui/Cover.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import Loader from '$lib/components/ui/Loader.svelte';
  import TrackList from '$lib/components/ui/TrackList.svelte';
  import { get } from 'svelte/store';
  import { lang, plural, tr } from '$lib/i18n';
  import { mixStore, startWaveFromTracks } from '$lib/recommend/engine';
  import { auth } from '$lib/stores/auth';
  import { playerActions } from '$lib/stores/player';
  import { say } from '$lib/stores/ui';
  import type { Playlist } from '$lib/types';
  import { artwork } from '$lib/utils';

  let playlist = $state<Playlist | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  const id = $derived(decodeURIComponent(page.params.id ?? ''));
  const isOwner = $derived(
    !!playlist && !playlist.virtual && $auth.user?.id !== undefined && playlist.user?.id === $auth.user.id
  );

  $effect(() => {
    const curId = id;
    if (!curId) return;
    loading = true;
    error = null;
    if (curId.startsWith('mix:')) {
      const m = mixStore.get(curId) ?? null;
      playlist = m;
      loading = false;
      if (!m) error = get(lang) === 'ru' ? 'Подборка устарела. Вернитесь на главную.' : 'Mix expired. Return to home.';
      return;
    }
    void sc
      .playlist(curId)
      .then((p) => (playlist = p))
      .catch((e) => (error = userMessage(e)))
      .finally(() => (loading = false));
  });

  async function remove() {
    if (!playlist || playlist.virtual) return;
    try {
      await sc.deletePlaylist(playlist.id);
      say(get(lang) === 'ru' ? 'Плейлист удалён' : 'Playlist deleted');
      await goto('/library?tab=playlists');
    } catch (e) {
      say(userMessage(e));
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
  {:else if playlist}
    {@const tracks = playlist.tracks ?? []}
    <div class="mb-6 flex items-end gap-6 pb-4">
      <Cover src={artwork(playlist.artwork_url ?? tracks[0]?.artwork_url, 't300x300')} size={144} radius={16} />
      <div class="min-w-0 flex-1">
        <div class="mb-1 text-[12px] text-dim">
          {playlist.virtual ? ($lang === 'ru' ? 'Подборка Arima' : 'Arima Mix') : ($lang === 'ru' ? 'Плейлист' : 'Playlist')}
        </div>
        <h1 class="truncate text-[28px] font-bold tracking-tight text-pure-white">{playlist.title}</h1>
        <div class="mt-1 text-[13px] text-dim">
          {#if playlist.user?.username}{playlist.user.username} · {/if}
          {tracks.length} {$lang === 'ru' ? plural(tracks.length, 'трек', 'трека', $tr.common.tracks) : tracks.length === 1 ? 'track' : 'tracks'}
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
          {#if isOwner}
            <Button onclick={remove}>
              <Icon name="trash" size={13} />
              <span>{$lang === 'ru' ? 'Удалить' : 'Delete'}</span>
            </Button>
          {/if}
        </div>
      </div>
    </div>

    <TrackList {tracks} />
  {/if}
</div>
