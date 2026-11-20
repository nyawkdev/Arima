<script lang="ts">  import '../app.css';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { cubicOut } from 'svelte/easing';
  import { fly } from 'svelte/transition';
  import { startBackgroundAiTrainer } from '$lib/ai/trainer';
  import { ipc } from '$lib/api/arima';
  import NowPlaying from '$lib/components/player/NowPlaying.svelte';
  import PlayerBar from '$lib/components/player/PlayerBar.svelte';
  import QueuePanel from '$lib/components/player/QueuePanel.svelte';
  import PlaylistPicker from '$lib/components/ui/PlaylistPicker.svelte';
  import Titlebar from '$lib/components/ui/Titlebar.svelte';
  import TrackMenu from '$lib/components/ui/TrackMenu.svelte';
  import { auth, restoreSession } from '$lib/stores/auth';
  import { loadLikes, resetLibrary } from '$lib/stores/library';
  import { initLyricsWatcher } from '$lib/stores/lyrics';
  import { applyAudioSettings, player, playerActions, position, restorePlayerSession } from '$lib/stores/player';
  import { customWallpaper, extractCoverAccent, loadSettings, settings } from '$lib/stores/settings';
  import { expandedOpen, queueOpen } from '$lib/stores/ui';
  import { toggleLike } from '$lib/stores/library';
  import { startSystemSync } from '$lib/system/sync';
  import { trackArtwork } from '$lib/utils';

  let { children } = $props();

  let expandedTab = $state<'overview' | 'lyrics' | 'queue' | 'eq'>('overview');

  const isIsland = $derived(page.url.pathname === '/island');
  const isFx = $derived(page.url.pathname === '/fx');
  const isOverlay = $derived(isIsland || isFx);
  const isLogin = $derived(page.url.pathname === '/login');
  const isOnboarding = $derived(page.url.pathname === '/onboarding');

  let prevPath = '';
  $effect(() => {
    const p = page.url.pathname;
    if (prevPath && p !== prevPath) {
      expandedOpen.set(false);
    }
    prevPath = p;
  });

  $effect(() => {
    if (typeof document === 'undefined') return;
    const bg = isOverlay ? 'transparent' : 'var(--bg)';
    document.documentElement.style.background = bg;
    document.body.style.background = bg;
  });

  onMount(() => {
    if (isOverlay) return;

    let stopSync: (() => void) | undefined;
    let stopTrainer: (() => void) | undefined;

    void (async () => {
      await loadSettings();
      applyAudioSettings();
      restorePlayerSession();
      await restoreSession();
      initLyricsWatcher();
      stopTrainer = startBackgroundAiTrainer();
      stopSync = await startSystemSync();
      if (!get(settings).ui?.onboardingDone && page.url.pathname !== '/onboarding') {
        await goto('/onboarding');
      }
      await ipc.app.ready().catch(() => undefined);
    })();

    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyF') {
        e.preventDefault();
        void goto('/search');
        return;
      }
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        void playerActions.toggle();
      } else if (e.code === 'ArrowRight' && e.altKey) {
        void playerActions.next();
      } else if (e.code === 'ArrowLeft' && e.altKey) {
        void playerActions.prev();
      } else if (e.code === 'ArrowRight') {
        playerActions.seek($position + 5);
      } else if (e.code === 'ArrowLeft') {
        playerActions.seek(Math.max(0, $position - 5));
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        playerActions.setVolume($player.volume + 0.05);
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        playerActions.setVolume($player.volume - 0.05);
      } else if (e.code === 'KeyM') {
        playerActions.toggleMute();
      } else if (e.code === 'KeyQ') {
        queueOpen.update((v) => !v);
      } else if (e.code === 'KeyK') {
        expandedTab = 'lyrics';
        expandedOpen.update((v) => !v);
      } else if (e.code === 'KeyL' && $player.current) {
        void toggleLike($player.current).catch(() => undefined);
      }
    };

    const onContextMenu = (e: MouseEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('contextmenu', onContextMenu);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('contextmenu', onContextMenu);
      stopSync?.();
      stopTrainer?.();
    };
  });

  $effect(() => {
    if (isOverlay) return;
    const tr = $player.current;
    if (tr && $settings.ui?.accentPreset === 'track') {
      void extractCoverAccent(trackArtwork(tr, 't120x120'));
    }
  });

  $effect(() => {
    if (isOverlay) return;
    if ($auth.status === 'authenticated') {
      void loadLikes();
      if (isLogin) void goto('/');
    } else if ($auth.status === 'anonymous') {
      resetLibrary();
    }
  });
</script>

{#if isOverlay}
  {@render children()}
{:else}
  <div class="relative flex h-screen w-screen flex-col overflow-hidden bg-pure-black text-pure-white">
    {#if $customWallpaper}
      <img
        src={$customWallpaper}
        alt=""
        class="pointer-events-none absolute inset-0 h-full w-full scale-105 object-cover opacity-40 blur-2xl"
        draggable="false"
      />
      <div class="pointer-events-none absolute inset-0 bg-pure-black/55"></div>
    {/if}

    <div class="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div
        class="absolute -left-24 -top-24 h-[520px] w-[520px] rounded-full opacity-[0.13] blur-[170px] transition-colors duration-500"
        style="background: var(--accent)"
      ></div>
      <div
        class="absolute right-8 top-28 h-[420px] w-[420px] rounded-full opacity-[0.1] blur-[160px] transition-colors duration-500"
        style="background: var(--accent-2)"
      ></div>
      <div
        class="absolute bottom-12 left-1/3 h-[280px] w-[440px] rounded-full opacity-[0.08] blur-[150px] transition-colors duration-500"
        style="background: var(--accent)"
      ></div>
    </div>

    {#if !isOnboarding}
      <Titlebar />
    {/if}
    <main class="scroll-y relative z-10 min-w-0 flex-1 {isOnboarding ? '' : 'pb-6'}">
      {#key page.url.pathname}
        <div in:fly={{ y: 10, duration: 230, easing: cubicOut }}>
          {@render children()}
        </div>
      {/key}
    </main>
    {#if !isOnboarding}
      <PlayerBar onOpenTab={(t) => (expandedTab = t)} />
      <NowPlaying bind:tab={expandedTab} />
      <QueuePanel />
      <TrackMenu />
      <PlaylistPicker />
    {/if}
  </div>
{/if}
