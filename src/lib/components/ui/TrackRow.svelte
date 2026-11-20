<script lang="ts">  import Cover from '$lib/components/ui/Cover.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import { lang } from '$lib/i18n';
  import { likedIds, toggleLike } from '$lib/stores/library';
  import { player } from '$lib/stores/player';
  import { menu, say } from '$lib/stores/ui';
  import { userMessage } from '$lib/api/arima';
  import type { Track } from '$lib/types';
  import { formatCount, formatTime, trackArtwork } from '$lib/utils';

  let {
    track,
    index,
    onplay,
    showPlays = false
  }: { track: Track; index?: number; onplay: () => void; showPlays?: boolean } = $props();

  const current = $derived($player.current?.id === track.id);
  const playing = $derived(current && $player.status === 'playing');
  const liked = $derived($likedIds.has(track.id));

  async function like(e: Event) {
    e.stopPropagation();
    try {
      await toggleLike(track);
    } catch (err) {
      say(userMessage(err));
    }
  }

  function openMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    menu.set({ x: e.clientX, y: e.clientY, track });
  }
</script>

<div
  class="row group relative grid cursor-default items-center gap-3 rounded-xl px-3 py-2 transition-colors {current
    ? 'bg-surface-2 text-pure-white'
    : 'text-dim hover:bg-hover hover:text-pure-white'}"
  style="grid-template-columns: 28px 42px minmax(0,1fr) auto 46px 30px 30px"
  role="button"
  tabindex="0"
  ondblclick={onplay}
  onkeydown={(e) => e.key === 'Enter' && onplay()}
  oncontextmenu={openMenu}
>
  <button class="flex h-7 w-7 items-center justify-center text-[12px]" onclick={onplay} aria-label={$lang === 'ru' ? 'Играть' : 'Play'}>
    {#if playing}
      <span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>
    {:else}
      <span class="group-hover:hidden">{index !== undefined ? index + 1 : ''}</span>
      <span class="hidden group-hover:block"><Icon name="play" size={13} /></span>
    {/if}
  </button>

  <Cover src={trackArtwork(track, 't120x120')} size={42} radius={6} />

  <div class="min-w-0">
    <div class="flex items-center gap-2">
      <div class="truncate text-[13px] font-medium {current ? 'text-pure-white' : 'text-pure-white/95'}">{track.title}</div>
      {#if track.badge}
        <span class="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-dim">{track.badge}</span>
      {/if}
    </div>
    {#if track.user?.id}
      <a
        href="/artist/{track.user.id}"
        class="inline-block max-w-full truncate text-[12px] text-dim hover:text-pure-white hover:underline"
        onclick={(e) => e.stopPropagation()}
      >
        {track.user.username}
      </a>
    {:else}
      <div class="truncate text-[12px] text-dim">{track.user?.username}</div>
    {/if}
  </div>

  <div class="text-right text-[12px] text-dim">{showPlays ? formatCount(track.playback_count) : ''}</div>
  <div class="text-right text-[12px] text-dim">{formatTime(track.duration / 1000)}</div>

  <button
    class="flex h-7 w-7 items-center justify-center rounded-full {liked
      ? 'text-pure-white'
      : 'text-faint opacity-0 group-hover:opacity-100 hover:text-pure-white'}"
    onclick={like}
    aria-label={$lang === 'ru' ? 'Лайк' : 'Like'}
    aria-pressed={liked}
  >
    <Icon name={liked ? 'heart-fill' : 'heart'} size={14} />
  </button>
  <button
    class="flex h-7 w-7 items-center justify-center rounded-full text-faint opacity-0 hover:text-pure-white group-hover:opacity-100"
    onclick={openMenu}
    aria-label={$lang === 'ru' ? 'Действия' : 'Actions'}
  >
    <Icon name="more" size={15} />
  </button>
</div>

<style>  .row {
    content-visibility: auto;
    contain-intrinsic-size: auto 58px;
  }
  .eq {
    display: inline-flex;
    align-items: flex-end;
    gap: 2px;
    height: 12px;
  }
  .eq i {
    display: block;
    width: 2px;
    border-radius: 2px;
    background: var(--accent);
    animation: eq 0.9s ease-in-out infinite;
  }
  .eq i:nth-child(2) {
    animation-delay: -0.3s;
  }
  .eq i:nth-child(3) {
    animation-delay: -0.6s;
  }
  @keyframes eq {
    0%,
    100% {
      height: 3px;
    }
    50% {
      height: 12px;
    }
  }
</style>
