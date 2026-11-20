<script lang="ts">  import { goto } from '$app/navigation';
  import { fly } from 'svelte/transition';
  import { userMessage } from '$lib/api/arima';
  import Icon from '$lib/components/ui/Icon.svelte';
  import { lang } from '$lib/i18n';
  import { startWaveFromTrack } from '$lib/recommend/engine';
  import { loadPlaylists } from '$lib/stores/library';
  import { playerActions } from '$lib/stores/player';
  import { menu, picker, say } from '$lib/stores/ui';
  import { onMount } from 'svelte';

  let el: HTMLDivElement | undefined = $state();
  let pos = $state({ x: 0, y: 0 });

  const m = $derived($menu);

  $effect(() => {
    if (!m || !el) return;
    const r = el.getBoundingClientRect();
    pos = {
      x: Math.min(m.x, window.innerWidth - r.width - 8),
      y: Math.min(m.y, window.innerHeight - r.height - 8)
    };
  });

  onMount(() => {
    const close = () => menu.set(null);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('pointerdown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', esc);
    };
  });

  function run(fn: () => void) {
    fn();
    menu.set(null);
  }
</script>

{#if m}
  <div
    bind:this={el}
    transition:fly={{ y: 6, duration: 140 }}
    class="fixed z-50 w-60 rounded-2xl bg-pure-black/95 p-1.5 backdrop-blur-2xl"
    style="left:{pos.x}px;top:{pos.y}px;box-shadow: inset 0 0 0 1px rgba(255,255,255,0.12), 0 18px 40px -12px rgba(0,0,0,0.65)"
    role="menu"
    tabindex="-1"
    onpointerdown={(e) => e.stopPropagation()}
  >
    <div class="mb-1 border-b border-line px-3 py-2">
      <div class="truncate text-[12px] font-semibold text-pure-white">{m.track.title}</div>
      {#if m.track.user?.username}
        <div class="truncate text-[11px] text-dim">{m.track.user.username}</div>
      {/if}
    </div>
    <button class="item" role="menuitem" onclick={() => run(() => playerActions.playQueue([m.track]))}>
      <Icon name="play" size={13} />
      <span>{$lang === 'ru' ? 'Играть сейчас' : 'Play now'}</span>
    </button>
    <button class="item" role="menuitem" onclick={() => run(() => playerActions.playNext(m.track))}>
      <Icon name="next" size={13} />
      <span>{$lang === 'ru' ? 'Играть следующим' : 'Play next'}</span>
    </button>
    <button class="item" role="menuitem" onclick={() => run(() => playerActions.enqueue([m.track]))}>
      <Icon name="queue" size={13} />
      <span>{$lang === 'ru' ? 'Добавить в очередь' : 'Add to queue'}</span>
    </button>
    <button
      class="item"
      role="menuitem"
      onclick={() =>
        run(() => {
          void startWaveFromTrack(m.track).catch((e) => say(userMessage(e)));
        })}
    >
      <Icon name="wave" size={13} />
      <span>{$lang === 'ru' ? 'Волна по треку' : 'Track radio'}</span>
    </button>
    <div class="my-1 h-px bg-line"></div>
    {#if m.track.user?.id}
      <button class="item" role="menuitem" onclick={() => run(() => void goto(`/artist/${m.track.user.id}`))}>
        <Icon name="external" size={13} />
        <span>{$lang === 'ru' ? 'Перейти к артисту' : 'Go to artist'}</span>
      </button>
    {/if}
    <button
      class="item"
      role="menuitem"
      onclick={() => run(() => { void loadPlaylists(); picker.set(m.track); })}
    >
      <Icon name="plus" size={13} />
      <span>{$lang === 'ru' ? 'Добавить в плейлист' : 'Add to playlist'}</span>
    </button>
  </div>
{/if}

<style>  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 11px;
    border-radius: 10px;
    font-size: 12.5px;
    font-weight: 500;
    text-align: left;
    color: var(--fg);
    opacity: 0.82;
    transition: background-color 0.14s ease, opacity 0.14s ease;
  }
  .item:hover,
  .item:focus-visible {
    opacity: 1;
    background: var(--hover);
  }
</style>
