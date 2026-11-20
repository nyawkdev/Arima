<script lang="ts">  import Cover from '$lib/components/ui/Cover.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import { lang, plural, tr } from '$lib/i18n';
  import { playerActions } from '$lib/stores/player';
  import type { Playlist } from '$lib/types';
  import { artwork } from '$lib/utils';

  let { playlist, href }: { playlist: Playlist; href: string } = $props();

  function quickPlay(e: MouseEvent) {
    if (!playlist.tracks?.length) return;
    e.preventDefault();
    e.stopPropagation();
    void playerActions.playQueue(playlist.tracks, 0);
  }
</script>

<a {href} class="group block min-w-0 rounded-2xl p-2.5 transition-all duration-200 hover:bg-pure-white/[0.06]">
  <div class="relative aspect-square w-full overflow-hidden rounded-xl" style="box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08)">
    <Cover src={artwork(playlist.artwork_url ?? playlist.tracks?.[0]?.artwork_url, 't300x300')} size={0} radius={12} />
    {#if playlist.tracks?.length}
      <button
        class="accent-surface absolute bottom-2.5 right-2.5 flex h-10 w-10 translate-y-2 items-center justify-center rounded-full opacity-0 transition-all duration-200 hover:scale-105 group-hover:translate-y-0 group-hover:opacity-100"
        onclick={quickPlay}
        aria-label={$lang === 'ru' ? 'Слушать плейлист' : 'Play playlist'}
      >
        <Icon name="play" size={14} />
      </button>
    {/if}
  </div>
  <div class="mt-2.5 truncate text-[13px] font-medium text-pure-white">{playlist.title}</div>
  <div class="truncate text-[12px] text-dim">
    {playlist.track_count}
    {$lang === 'ru' ? plural(playlist.track_count, 'трек', 'трека', $tr.common.tracks) : playlist.track_count === 1 ? 'track' : 'tracks'}
  </div>
</a>
