<script lang="ts">  import { onMount } from 'svelte';
  import { emit, listen } from '@tauri-apps/api/event';
  import { ipc, isTauri } from '$lib/api/arima';
  import Icon from '$lib/components/ui/Icon.svelte';
  import Slider from '$lib/components/ui/Slider.svelte';
  import { lang } from '$lib/i18n';
  import { loadSettings, settings } from '$lib/stores/settings';
  import type { PlayerCommand, PlayerSnapshot } from '$lib/types';
  import { artwork, formatTime } from '$lib/utils';

  let snap = $state<PlayerSnapshot | null>(null);
  let hovered = $state(false);
  let showQueue = $state(false);
  let interacting = $state(false);
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  let nowPos = $state(0);
  let cardEl: HTMLDivElement | undefined = $state();

  const styleMode = $derived($settings.island.style ?? 'island');
  const expanded = $derived(
    styleMode === 'mini' ? true : styleMode === 'pill' ? false : hovered || showQueue || interacting
  );

  function send(c: PlayerCommand) {
    if (isTauri) void emit('player-cmd', c);
  }

  function reportRect() {
    if (!isTauri || !cardEl) return;
    const r = cardEl.getBoundingClientRect();
    void ipc.island.setRect({ x: r.left, y: r.top, w: r.width, h: r.height }).catch(() => undefined);
  }

  $effect(() => {
    expanded;
    showQueue;
    styleMode;
    snap?.track?.id;
    requestAnimationFrame(reportRect);
  });

  onMount(() => {
    if (!isTauri) return;
    let unSync: (() => void) | undefined;
    let unHover: (() => void) | undefined;

    void loadSettings();

    void (async () => {
      unSync = await listen<PlayerSnapshot>('player-sync', (e) => {
        snap = e.payload;
        nowPos = e.payload.position;
      });
      unHover = await listen<{ hover: boolean }>('island-hover', (e) => {
        clearTimeout(leaveTimer);
        if (e.payload.hover) {
          hovered = true;
        } else {
          leaveTimer = setTimeout(() => {
            if (!interacting && !showQueue) hovered = false;
          }, 260);
        }
      });
      await emit('island-ready');
      reportRect();
    })();

    const tick = setInterval(() => {
      if (snap?.status === 'playing') {
        const elapsed = (Date.now() - snap.stamp) / 1000;
        nowPos = Math.min(snap.track ? snap.track.duration / 1000 : 0, snap.position + elapsed);
      }
    }, 250);

    return () => {
      clearTimeout(leaveTimer);
      clearInterval(tick);
      unSync?.();
      unHover?.();
    };
  });

  const dur = $derived(snap?.track ? snap.track.duration / 1000 : 0);
  const pct = $derived(dur > 0 ? Math.min(100, Math.max(0, (nowPos / dur) * 100)) : 0);
</script>

<div class="flex h-screen w-screen items-start justify-center bg-transparent pt-0">
  {#if snap?.track}
    <div
      bind:this={cardEl}
      role="region"
      aria-label={$lang === 'ru' ? 'Мини-плеер' : 'Mini player'}
      onpointerdown={() => (interacting = true)}
      onpointerup={() => (interacting = false)}
      onpointercancel={() => (interacting = false)}
      style="box-shadow: inset 0 0 0 1px rgba(255,255,255,0.14), 0 14px 36px rgba(0,0,0,0.65)"
      class="overflow-hidden rounded-[22px] bg-pure-black/92 text-pure-white backdrop-blur-2xl transition-all duration-200 {styleMode ===
      'pill'
        ? 'w-[340px]'
        : expanded
          ? 'w-[496px]'
          : 'w-[248px]'}"
    >
      {#if styleMode === 'pill'}
        <div class="flex h-11 items-center gap-2.5 px-3.5">
          <button
            class="shrink-0 overflow-hidden rounded-full"
            style="box-shadow: inset 0 0 0 1px rgba(255,255,255,0.16)"
            onclick={() => send({ cmd: 'showMain' })}
          >
            {#if snap.track.artwork_url}
              <img src={artwork(snap.track.artwork_url, 't50x50')} alt="" class="h-6 w-6 object-cover" draggable="false" />
            {/if}
          </button>
          <div class="min-w-0 flex-1 truncate text-[12px] font-medium text-pure-white">
            {snap.track.title} <span class="text-dim">• {snap.track.artist}</span>
          </div>
          <div class="flex items-center gap-0.5">
            <button class="flex h-7 w-7 items-center justify-center rounded-full text-dim hover:text-pure-white" onclick={() => send({ cmd: 'prev' })} aria-label={$lang === 'ru' ? 'Предыдущий' : 'Previous'}>
              <Icon name="prev" size={13} />
            </button>
            <button class="accent-surface flex h-7 w-7 items-center justify-center rounded-full" onclick={() => send({ cmd: 'toggle' })} aria-label={$lang === 'ru' ? 'Пауза' : 'Pause'}>
              <Icon name={snap.status === 'playing' ? 'pause' : 'play'} size={12} />
            </button>
            <button class="flex h-7 w-7 items-center justify-center rounded-full text-dim hover:text-pure-white" onclick={() => send({ cmd: 'next' })} aria-label={$lang === 'ru' ? 'Следующий' : 'Next'}>
              <Icon name="next" size={13} />
            </button>
            <button class="flex h-7 w-7 items-center justify-center rounded-full text-dim hover:text-pure-white" onclick={() => void ipc.island.toggleHidden()} aria-label={$lang === 'ru' ? 'Скрыть' : 'Hide'}>
              <Icon name="eye-off" size={12} />
            </button>
          </div>
        </div>
      {:else if !expanded}
        <div class="flex h-9 items-center gap-2.5 px-3">
          {#if snap.track.artwork_url}
            <img
              src={artwork(snap.track.artwork_url, 't50x50')}
              alt=""
              class="h-5 w-5 rounded-full object-cover"
              draggable="false"
            />
          {/if}
          <div class="min-w-0 flex-1 truncate text-[12px] font-medium text-pure-white">{snap.track.title}</div>
          <div class="h-1 w-10 shrink-0 overflow-hidden rounded-full bg-surface-2">
            <div class="h-full" style="width:{pct}%; background: var(--accent)"></div>
          </div>
        </div>
      {:else}
        <div class="px-4 py-3">
          <div class="flex items-center gap-3.5">
            <button
              class="shrink-0 overflow-hidden rounded-xl"
              style="box-shadow: inset 0 0 0 1px rgba(255,255,255,0.14)"
              onclick={() => send({ cmd: 'showMain' })}
              aria-label={$lang === 'ru' ? 'Открыть Arima' : 'Open Arima'}
            >
              {#if snap.track.artwork_url}
                <img
                  src={artwork(snap.track.artwork_url, 't120x120')}
                  alt=""
                  class="h-12 w-12 object-cover"
                  draggable="false"
                />
              {:else}
                <div class="h-12 w-12 bg-surface"></div>
              {/if}
            </button>

            <div class="min-w-0 flex-1">
              <div class="truncate text-[13px] font-semibold text-pure-white">{snap.track.title}</div>
              <div class="truncate text-[11px] text-dim">{snap.track.artist}</div>
            </div>

            <div class="flex shrink-0 items-center gap-1">
              <button
                class="flex h-7 w-7 items-center justify-center rounded-full {snap.shuffle ? 'text-pure-white' : 'text-dim hover:text-pure-white'}"
                onclick={() => send({ cmd: 'shuffle' })}
                aria-label={$lang === 'ru' ? 'Перемешать' : 'Shuffle'}
              >
                <Icon name="shuffle" size={12} />
              </button>
              <button
                class="flex h-7 w-7 items-center justify-center rounded-full text-dim hover:text-pure-white"
                onclick={() => send({ cmd: 'prev' })}
                aria-label={$lang === 'ru' ? 'Предыдущий' : 'Previous'}
              >
                <Icon name="prev" size={14} />
              </button>
              <button
                class="accent-surface flex h-8 w-8 items-center justify-center rounded-full transition-transform hover:scale-105"
                onclick={() => send({ cmd: 'toggle' })}
                aria-label={snap.status === 'playing' ? ($lang === 'ru' ? 'Пауза' : 'Pause') : ($lang === 'ru' ? 'Играть' : 'Play')}
              >
                <Icon name={snap.status === 'playing' ? 'pause' : 'play'} size={13} />
              </button>
              <button
                class="flex h-7 w-7 items-center justify-center rounded-full text-dim hover:text-pure-white"
                onclick={() => send({ cmd: 'next' })}
                aria-label={$lang === 'ru' ? 'Следующий' : 'Next'}
              >
                <Icon name="next" size={14} />
              </button>
              <button
                class="flex h-7 w-7 items-center justify-center rounded-full {snap.repeat !== 'off' ? 'text-pure-white' : 'text-dim hover:text-pure-white'}"
                onclick={() => send({ cmd: 'repeat' })}
                aria-label={$lang === 'ru' ? 'Повтор' : 'Repeat'}
              >
                <Icon name={snap.repeat === 'one' ? 'repeat-one' : 'repeat'} size={12} />
              </button>
              <button
                class="flex h-7 w-7 items-center justify-center rounded-full {showQueue ? 'accent-pill' : 'text-dim hover:text-pure-white'}"
                onclick={() => (showQueue = !showQueue)}
                aria-label={$lang === 'ru' ? 'Очередь' : 'Queue'}
              >
                <Icon name="queue" size={12} />
              </button>
              <button
                class="flex h-7 w-7 items-center justify-center rounded-full text-dim hover:bg-hover hover:text-pure-white"
                onclick={() => {
                  showQueue = false;
                  hovered = false;
                  void ipc.island.toggleHidden();
                }}
                title={$lang === 'ru' ? 'Скрыть для этого трека' : 'Hide for this track'}
                aria-label={$lang === 'ru' ? 'Скрыть остров для этого трека' : 'Hide island for this track'}
              >
                <Icon name="eye-off" size={12} />
              </button>
            </div>
          </div>

          <div class="mt-2 flex items-center gap-2.5">
            <span class="w-8 text-right text-[10px] text-dim">{formatTime(nowPos)}</span>
            <div class="flex-1">
              <Slider value={nowPos} max={dur} height={3} onchange={(v) => send({ cmd: 'seek', value: v })} />
            </div>
            <span class="w-8 text-[10px] text-dim">{formatTime(dur)}</span>
          </div>

          {#if showQueue}
            <div class="mt-2 max-h-24 overflow-y-auto border-t border-line pt-1.5">
              {#each snap.queue as q, i (q.id + '-' + i)}
                {@const active = i === snap.index}
                <div class="flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-[11px] {active ? 'bg-surface-2 text-pure-white' : 'text-dim hover:text-pure-white'}">
                  <button class="min-w-0 flex-1 truncate text-left" onclick={() => send({ cmd: 'playIndex', value: i })}>
                    {q.title} — {q.artist}
                  </button>
                  {#if !active}
                    <button class="text-faint hover:text-pure-white" onclick={() => send({ cmd: 'removeIndex', value: i })} aria-label={$lang === 'ru' ? 'Удалить' : 'Remove'}>
                      <Icon name="x" size={11} />
                    </button>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>
