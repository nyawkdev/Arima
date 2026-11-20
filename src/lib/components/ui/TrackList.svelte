<script lang="ts">  import TrackRow from '$lib/components/ui/TrackRow.svelte';
  import { playerActions } from '$lib/stores/player';
  import type { Track } from '$lib/types';

  let {
    tracks,
    showPlays = false,
    numbered = true,
    refill = null
  }: { tracks: Track[]; showPlays?: boolean; numbered?: boolean; refill?: (() => Promise<Track[]>) | null } = $props();
</script>

<div role="list">
  {#each tracks as track, i (track.id)}
    <TrackRow
      {track}
      index={numbered ? i : undefined}
      {showPlays}
      onplay={() => playerActions.playQueue(tracks, i, refill)}
    />
  {/each}
</div>
