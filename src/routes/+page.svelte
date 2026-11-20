<script lang="ts">  import { onMount } from 'svelte';
  import { liquidMagnetic } from '$lib/actions/liquidMagnetic';
  import { ipc, userMessage } from '$lib/api/arima';
  import { sc } from '$lib/api/soundcloud';
  import Button from '$lib/components/ui/Button.svelte';
  import Cover from '$lib/components/ui/Cover.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import PlaylistCard from '$lib/components/ui/PlaylistCard.svelte';
  import TrackRow from '$lib/components/ui/TrackRow.svelte';
  import { lang, t, tr } from '$lib/i18n';
  import { forYou, mixes, mixStore, startMyWave, startWaveFromTrack } from '$lib/recommend/engine';
  import { auth } from '$lib/stores/auth';
  import { likedPlaylists, likedTracks, loadPlaylists, myPlaylists } from '$lib/stores/library';
  import { player, playerActions } from '$lib/stores/player';
  import { say } from '$lib/stores/ui';
  import type { Playlist, Track } from '$lib/types';
  import { trackArtwork } from '$lib/utils';

  let loading = $state(true);
  let waveBusy = $state(false);
  let error = $state<string | null>(null);

  let forYouTracks = $state<Track[]>([]);
  let mixList = $state<Playlist[]>([]);
  let historyTracks = $state<Track[]>([]);

  function dedupe(arr: Track[]): Track[] {
    const m = new Map<number, Track>();
    for (const x of arr) if (x?.id && !m.has(x.id)) m.set(x.id, x);
    return [...m.values()];
  }

  async function loadHome() {
    loading = true;
    error = null;
    try {
      const [mx, localHist, scHist] = await Promise.all([
        mixes(8).catch(() => [] as Playlist[]),
        ipc.history.list(100).catch(() => []),
        $auth.status === 'authenticated' ? sc.playHistory(30).catch(() => [] as Track[]) : Promise.resolve([])
      ]);
      if ($auth.status === 'authenticated') void loadPlaylists();

      mixList = mx;
      for (const m of mx) mixStore.set(String(m.id), m);
      const daily = mx.find((m) => m.id === 'mix:daily') ?? mx[0];
      const fy = daily?.tracks?.length ? daily.tracks.slice(0, 10) : await forYou(10).catch(() => [] as Track[]);
      forYouTracks = dedupe(fy).slice(0, 10);

      const merged = new Map<number, Track>();
      for (const h of localHist) if (h.track?.id) merged.set(h.track.id, h.track);
      for (const s of scHist) if (s?.id && !merged.has(s.id)) merged.set(s.id, s);
      historyTracks = [...merged.values()].slice(0, 100);
    } catch (e) {
      error = userMessage(e);
    } finally {
      loading = false;
    }
  }

  async function startWave() {
    if (waveBusy) return;
    waveBusy = true;
    try {
      if (!(await startMyWave())) {
        say('Недостаточно данных для волны');
      }
    } catch (e) {
      say(userMessage(e));
    } finally {
      waveBusy = false;
    }
  }

  async function startTrackWave() {
    if (waveBusy || !$player.current) return;
    waveBusy = true;
    try {
      await startWaveFromTrack($player.current);
    } catch (e) {
      say(userMessage(e));
    } finally {
      waveBusy = false;
    }
  }

  onMount(() => {
    void loadHome();
  });

  const waveArt = $derived(
    $player.current
      ? trackArtwork($player.current, 't300x300')
      : forYouTracks[0]
        ? trackArtwork(forYouTracks[0], 't300x300')
        : mixList[0]?.artwork_url
          ? trackArtwork(mixList[0] as unknown as Track, 't300x300')
          : ''
  );
</script>

<div class="mx-auto max-w-[1600px] px-6 py-3">
  <section class="oled-card relative mb-6 flex flex-wrap items-center justify-between gap-6 overflow-hidden rounded-3xl p-6">
    <div class="relative z-10 flex items-center gap-5">
      <div class="shrink-0 overflow-hidden rounded-2xl" style="box-shadow: inset 0 0 0 1px rgba(255,255,255,0.14)">
        <Cover src={waveArt} size={116} radius={16} />
      </div>
      <div>
        <h1 class="text-[28px] font-semibold text-pure-white">{$tr.home.wave}</h1>
        <p class="mt-0.5 text-[13px] text-dim">{$tr.home.waveSubtitle}</p>
        <div class="mt-4 flex flex-wrap items-center gap-2.5">
          <div class="relative inline-flex p-1.5 -m-1.5">
            <button
              use:liquidMagnetic={{ maxPull: 6, stretch: 0.06, snapDistance: 84 }}
              class="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-pure-white px-5 text-[13px] font-semibold text-pure-black will-change-transform disabled:opacity-50"
              disabled={waveBusy}
              onclick={startWave}
            >
              <Icon name="play" size={13} />
              <span>{waveBusy ? $tr.common.loading : $tr.home.waveStart}</span>
            </button>
          </div>
          {#if $player.current}
            <Button disabled={waveBusy} onclick={startTrackWave}>
              <Icon name="shuffle" size={13} />
              <span>{$tr.home.waveByTrack}: {$player.current.title.slice(0, 22)}{$player.current.title.length > 22 ? '…' : ''}</span>
            </Button>
          {/if}
        </div>
      </div>
    </div>

    <div class="relative z-10 flex gap-3">
      <a
        href="/library"
        class="flex h-28 w-44 flex-col justify-between rounded-2xl bg-pure-white/[0.04] p-4 transition-all hover:bg-pure-white/[0.08]"
        style="box-shadow: inset 0 0 0 1px rgba(255,255,255,0.1)"
      >
        <div class="flex items-center justify-between text-[13px] font-semibold text-pure-white">
          <span>{$tr.library.likes}</span>
          <Icon name="heart-fill" size={13} />
        </div>
        <div class="text-[12px] text-dim">{$likedTracks.length} {$tr.common.tracks}</div>
      </a>
      <a
        href="/library?tab=history"
        class="flex h-28 w-44 flex-col justify-between rounded-2xl bg-pure-white/[0.04] p-4 transition-all hover:bg-pure-white/[0.08]"
        style="box-shadow: inset 0 0 0 1px rgba(255,255,255,0.1)"
      >
        <div class="flex items-center justify-between text-[13px] font-semibold text-pure-white">
          <span>{$tr.home.history}</span>
          <Icon name="clock" size={13} />
        </div>
        <div class="text-[12px] text-dim">{historyTracks.length ? `${historyTracks.length}` : $tr.home.recent12}</div>
      </a>
    </div>
  </section>

  {#if loading}
    <div class="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div class="oled-card rounded-3xl p-5">
        <div class="skeleton mb-4 h-5 w-36 rounded-lg"></div>
        <div class="space-y-2.5">
          {#each Array(6) as _, i (i)}
            <div class="skeleton h-12 w-full rounded-xl"></div>
          {/each}
        </div>
      </div>
      <div class="oled-card rounded-3xl p-5">
        <div class="skeleton mb-4 h-5 w-44 rounded-lg"></div>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {#each Array(6) as _, i (i)}
            <div class="skeleton aspect-square w-full rounded-2xl"></div>
          {/each}
        </div>
      </div>
    </div>
  {:else if error}
    <div class="oled-card flex items-center justify-between rounded-2xl p-4">
      <span class="text-[13px] text-dim">{error}</span>
      <Button onclick={loadHome}>{t.common.retry}</Button>
    </div>
  {:else}
    {#if forYouTracks.length}
      <section class="oled-card mb-8 rounded-3xl p-5">
        <div class="mb-3 flex items-center justify-between px-2">
          <h2 class="text-[17px] font-bold text-pure-white">{$tr.home.forYou}</h2>
          <button
            class="text-[12px] font-medium text-dim transition-colors hover:text-pure-white"
            onclick={() => playerActions.playQueue(forYouTracks)}
          >
            {$tr.common.play}
          </button>
        </div>
        <div class="grid grid-cols-1 gap-x-4 lg:grid-cols-2">
          {#each forYouTracks.slice(0, 10) as track, i (track.id)}
            <TrackRow {track} index={i} onplay={() => playerActions.playQueue(forYouTracks, i)} />
          {/each}
        </div>
      </section>
    {/if}

    {#if mixList.length}
      <section class="oled-card mb-8 rounded-3xl p-5">
        <h2 class="section-title mb-3 px-1">{$tr.home.mixes}</h2>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {#each mixList as pl (pl.id)}
            <PlaylistCard playlist={pl} href={`/playlist/${encodeURIComponent(String(pl.id))}`} />
          {/each}
        </div>
      </section>
    {/if}

    {#if $myPlaylists.length || $likedPlaylists.length}
      <section class="oled-card mb-6 rounded-3xl p-5">
        <h2 class="section-title mb-3 px-1">{$lang === 'ru' ? 'Ваши плейлисты' : 'Your playlists'}</h2>
        <div class="scroll-x flex gap-3 pb-1">
          {#each [...$myPlaylists, ...$likedPlaylists] as pl (pl.id)}
            <div class="w-40 shrink-0">
              <PlaylistCard playlist={pl} href={`/playlist/${pl.id}`} />
            </div>
          {/each}
        </div>
      </section>
    {/if}
  {/if}
</div>
