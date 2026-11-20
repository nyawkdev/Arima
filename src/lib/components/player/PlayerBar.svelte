<script lang="ts">  import { fly } from 'svelte/transition';
  import { liquidMagnetic } from '$lib/actions/liquidMagnetic';
  import { userMessage } from '$lib/api/arima';
  import Cover from '$lib/components/ui/Cover.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import Slider from '$lib/components/ui/Slider.svelte';
  import { lang } from '$lib/i18n';
  import { likedIds, toggleLike } from '$lib/stores/library';
  import { duration, player, playerActions, position } from '$lib/stores/player';
  import { expandedOpen, menu, notice, say } from '$lib/stores/ui';
  import { formatTime, trackArtwork } from '$lib/utils';

  let { onOpenTab }: { onOpenTab: (t: 'overview' | 'lyrics' | 'queue' | 'eq') => void } = $props();

  let volOpen = $state(false);
  let volDragging = $state(false);
  let volTimer: ReturnType<typeof setTimeout> | undefined;

  const track = $derived($player.current);
  const playing = $derived($player.status === 'playing');
  const loading = $derived($player.status === 'loading');
  const liked = $derived(track ? $likedIds.has(track.id) : false);
  const totalSec = $derived($duration || (track ? track.duration / 1000 : 0));
  const curVol = $derived($player.muted ? 0 : $player.volume);

  async function like(e: Event) {
    e.stopPropagation();
    if (!track) return;
    try {
      await toggleLike(track);
    } catch (err) {
      say(userMessage(err));
    }
  }

  function openMenu(e: MouseEvent) {
    e.stopPropagation();
    if (!track) return;
    e.preventDefault();
    menu.set({ x: e.clientX, y: e.clientY - 140, track });
  }

  function expandBar() {
    if (!track) return;
    onOpenTab('overview');
    expandedOpen.update((v) => !v);
  }

  function showVol() {
    clearTimeout(volTimer);
    volOpen = true;
  }

  function hideVol() {
    if (volDragging) return;
    clearTimeout(volTimer);
    volTimer = setTimeout(() => {
      if (!volDragging) volOpen = false;
    }, 180);
  }

  function handleVolDrag(e: PointerEvent) {
    const el = e.currentTarget as HTMLElement;
    const calc = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const ratio = 1 - Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
      playerActions.setVolume(ratio);
    };
    volDragging = true;
    el.setPointerCapture(e.pointerId);
    calc(e);
  }
</script>

<footer
  class="relative z-40 flex h-[84px] w-full shrink-0 cursor-pointer items-center gap-4 border-t border-line bg-pure-black/92 px-6 backdrop-blur-2xl transition-all duration-300 hover:bg-pure-black/96"
  onclick={expandBar}
  onkeydown={(e) => e.key === 'Enter' && expandBar()}
>
  <div class="flex min-w-0 flex-1 items-center gap-3.5">
    <div class="relative shrink-0 overflow-hidden rounded-xl transition-transform duration-200 hover:scale-[1.03]" style="box-shadow: inset 0 0 0 1px rgba(255,255,255,0.12), 0 6px 18px -6px rgba(0,0,0,0.5)">
      <Cover src={track ? trackArtwork(track, 't120x120') : ''} size={52} radius={12} />
    </div>

    <div class="min-w-0 flex-1">
      {#if track}
        <div class="truncate text-[14px] font-semibold text-pure-white">{track.title}</div>
        {#if track.user?.id}
          <a
            href="/artist/{track.user.id}"
            class="inline-block max-w-full truncate text-[12px] text-dim hover:text-pure-white hover:underline"
            onclick={(e) => e.stopPropagation()}
          >
            {track.user.username}
          </a>
        {/if}
      {:else}
        <div class="text-[13px] text-faint">{$lang === 'ru' ? 'Ничего не играет' : 'Nothing playing'}</div>
      {/if}
    </div>

    {#if track}
      <button
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-transform hover:scale-110 {liked
          ? 'text-pure-white'
          : 'text-dim hover:text-pure-white'}"
        onclick={like}
        aria-label={$lang === 'ru' ? 'Лайк' : 'Like'}
      >
        <Icon name={liked ? 'heart-fill' : 'heart'} size={15} />
      </button>
    {/if}
  </div>

  <div class="flex w-[44%] max-w-xl flex-col items-center gap-1.5" onclick={(e) => e.stopPropagation()}>
    <div class="flex items-center gap-2.5">
      <button
        class="flex h-8 w-8 items-center justify-center rounded-full transition-all duration-150 hover:bg-hover active:scale-95 {$player.shuffle
          ? 'text-pure-white'
          : 'text-dim hover:text-pure-white'}"
        onclick={() => playerActions.toggleShuffle()}
        aria-label={$lang === 'ru' ? 'Перемешать' : 'Shuffle'}
      >
        <Icon name="shuffle" size={15} />
      </button>
      <button
        class="flex h-8 w-8 items-center justify-center rounded-full text-dim transition-all duration-150 hover:bg-hover hover:text-pure-white active:scale-95"
        onclick={() => playerActions.prev()}
        aria-label={$lang === 'ru' ? 'Предыдущий' : 'Previous'}
      >
        <Icon name="prev" size={16} />
      </button>
      <div class="relative flex items-center justify-center p-2 -m-2">
        <button
          use:liquidMagnetic={{ maxPull: 11, stretch: 0.2, snapDistance: 46 }}
          class="accent-surface flex h-10 w-10 items-center justify-center rounded-full will-change-transform"
          onclick={() => playerActions.toggle()}
          aria-label={playing ? ($lang === 'ru' ? 'Пауза' : 'Pause') : ($lang === 'ru' ? 'Играть' : 'Play')}
        >
          {#if loading}
            <span class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"></span>
          {:else}
            <Icon name={playing ? 'pause' : 'play'} size={15} />
          {/if}
        </button>
      </div>
      <button
        class="flex h-8 w-8 items-center justify-center rounded-full text-dim transition-all duration-150 hover:bg-hover hover:text-pure-white active:scale-95"
        onclick={() => playerActions.next()}
        aria-label={$lang === 'ru' ? 'Следующий' : 'Next'}
      >
        <Icon name="next" size={16} />
      </button>
      <button
        class="flex h-8 w-8 items-center justify-center rounded-full transition-all duration-150 hover:bg-hover active:scale-95 {$player.repeat !== 'off'
          ? 'text-pure-white'
          : 'text-dim hover:text-pure-white'}"
        onclick={() => playerActions.cycleRepeat()}
        aria-label={$lang === 'ru' ? 'Повтор' : 'Repeat'}
      >
        <Icon name={$player.repeat === 'one' ? 'repeat-one' : 'repeat'} size={15} />
      </button>
    </div>

    <div class="flex w-full items-center gap-2.5">
      <span class="w-9 text-right text-[11px] text-dim">{formatTime($position)}</span>
      <div class="flex-1">
        <Slider value={$position} max={totalSec} height={3} label={$lang === 'ru' ? 'Позиция' : 'Seek'} onchange={(v) => playerActions.seek(v)} />
      </div>
      <span class="w-9 text-[11px] text-dim">{formatTime(totalSec)}</span>
    </div>
  </div>

  <div class="flex flex-1 items-center justify-end gap-2" onclick={(e) => e.stopPropagation()}>
    {#if $notice}
      <span class="max-w-[160px] truncate text-[11px] text-pure-white">{$notice.text}</span>
    {:else if $player.error}
      <span class="max-w-[160px] truncate text-[11px] text-dim">{$player.error}</span>
    {/if}

    <div
      class="relative flex items-center"
      role="group"
      aria-label={$lang === 'ru' ? 'Громкость' : 'Volume'}
      onpointerenter={showVol}
      onpointerleave={hideVol}
    >
      {#if volOpen}
        <div
          transition:fly={{ y: 8, duration: 150 }}
          class="absolute bottom-full left-1/2 mb-2 flex -translate-x-1/2 flex-col items-center rounded-2xl bg-pure-black/95 px-3 py-3 backdrop-blur-2xl"
          style="box-shadow: inset 0 0 0 1px rgba(255,255,255,0.16), 0 0 24px rgba(255,255,255,0.12)"
          role="group"
          onpointerenter={showVol}
          onpointerleave={hideVol}
        >
          <span class="mb-2 text-[10px] font-medium text-dim">{Math.round(curVol * 100)}%</span>
          <div
            class="relative flex h-28 w-6 cursor-ns-resize items-center justify-center touch-none"
            role="slider"
            tabindex="0"
            aria-label={$lang === 'ru' ? 'Громкость' : 'Volume'}
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={Math.round(curVol * 100)}
            onpointerdown={handleVolDrag}
            onpointermove={(e) => {
              if (volDragging) handleVolDrag(e);
            }}
            onpointerup={() => {
              volDragging = false;
            }}
          >
            <div class="relative h-full w-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                class="absolute bottom-0 left-0 w-full rounded-full bg-pure-white"
                style="height:{curVol * 100}%"
              ></div>
            </div>
            <div
              class="pointer-events-none absolute h-3.5 w-3.5 rounded-full bg-pure-white"
              style="bottom:calc({curVol * 100}% - 7px)"
            ></div>
          </div>
        </div>
      {/if}

      <button
        class="flex h-8 w-8 items-center justify-center rounded-full text-dim transition-all duration-150 hover:bg-hover hover:text-pure-white active:scale-95"
        onclick={() => playerActions.toggleMute()}
        aria-label={$lang === 'ru' ? 'Звук' : 'Mute'}
      >
        <Icon name={$player.muted || $player.volume === 0 ? 'volume-x' : 'volume'} size={16} />
      </button>
    </div>

    <button
      class="flex h-8 w-8 items-center justify-center rounded-full text-dim transition-all duration-150 hover:bg-hover hover:text-pure-white active:scale-95"
      onclick={openMenu}
      disabled={!track}
      aria-label={$lang === 'ru' ? 'Меню' : 'Menu'}
    >
      <Icon name="more" size={16} />
    </button>
  </div>
</footer>
