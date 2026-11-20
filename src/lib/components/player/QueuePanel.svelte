<script lang="ts">  import Cover from '$lib/components/ui/Cover.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import { lang } from '$lib/i18n';
  import { player, playerActions } from '$lib/stores/player';
  import { queueOpen } from '$lib/stores/ui';
  import { formatTime, trackArtwork } from '$lib/utils';
</script>

{#if $queueOpen}
  <aside class="fixed bottom-[94px] right-4 top-16 z-40 flex w-80 flex-col rounded-2xl border border-pure-white/15 bg-pure-black/85 backdrop-blur-2xl">
    <div class="flex items-center justify-between border-b border-line px-4 py-3">
      <span class="label">{$lang === 'ru' ? 'Очередь' : 'Queue'} ({$player.queue.length})</span>
      <div class="flex items-center gap-2">
        <button
          class="text-[12px] font-medium text-dim hover:text-pure-white"
          onclick={() => playerActions.clearUpcoming()}
        >
          {$lang === 'ru' ? 'Очистить' : 'Clear'}
        </button>
        <button
          class="flex h-7 w-7 items-center justify-center text-dim hover:text-pure-white"
          onclick={() => queueOpen.set(false)}
          aria-label={$lang === 'ru' ? 'Закрыть очередь' : 'Close queue'}
        >
          <Icon name="x" size={14} />
        </button>
      </div>
    </div>

    <div class="scroll-y flex-1">
      {#each $player.queue as track, i (track.id + '-' + i)}
        {@const active = i === $player.index}
        <div
          class="group relative flex items-center gap-3 border-b border-line px-4 py-2 {active
            ? 'text-pure-white'
            : 'text-dim hover:text-pure-white'}"
        >
          {#if active}<span class="absolute inset-y-0 left-0 w-[2px] bg-pure-white"></span>{/if}
          <button
            class="flex min-w-0 flex-1 items-center gap-3 text-left"
            onclick={() => playerActions.playIndex(i)}
          >
            <Cover src={trackArtwork(track, 't120x120')} size={34} />
            <div class="min-w-0 flex-1">
              <div class="truncate text-[12px] {active ? 'text-pure-white' : 'text-pure-white/85'}">
                {track.title}
              </div>
              <div class="truncate text-[11px] text-dim">{track.user?.username}</div>
            </div>
          </button>
          <span class="text-[11px] tabular-nums text-dim">{formatTime(track.duration / 1000)}</span>
          {#if !active}
            <button
              class="opacity-0 group-hover:opacity-100 text-dim hover:text-pure-white"
              onclick={() => playerActions.removeAt(i)}
              aria-label="Убрать из очереди"
            >
              <Icon name="x" size={12} />
            </button>
          {/if}
        </div>
      {:else}
        <div class="p-6 text-[12px] text-dim">{$lang === 'ru' ? 'Очередь пуста' : 'Queue is empty'}</div>
      {/each}
    </div>
  </aside>
{/if}
