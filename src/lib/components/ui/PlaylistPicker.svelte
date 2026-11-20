<script lang="ts">  import { userMessage } from '$lib/api/arima';
  import { sc } from '$lib/api/soundcloud';
  import Button from '$lib/components/ui/Button.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import { get } from 'svelte/store';
  import Input from '$lib/components/ui/Input.svelte';
  import { lang } from '$lib/i18n';
  import { loadPlaylists, myPlaylists } from '$lib/stores/library';
  import { picker, say } from '$lib/stores/ui';

  let newTitle = $state('');
  let busy = $state(false);
  const track = $derived($picker);

  async function add(id: number | string) {
    if (!track || busy) return;
    busy = true;
    try {
      await sc.addToPlaylist(id, track.id);
      say(get(lang) === 'ru' ? 'Добавлено в плейлист' : 'Added to playlist');
      picker.set(null);
    } catch (e) {
      say(userMessage(e));
    } finally {
      busy = false;
    }
  }

  async function create(e: SubmitEvent) {
    e.preventDefault();
    if (!track || !newTitle.trim() || busy) return;
    busy = true;
    try {
      await sc.createPlaylist(newTitle.trim(), [track.id]);
      newTitle = '';
      await loadPlaylists();
      say(get(lang) === 'ru' ? 'Плейлист создан' : 'Playlist created');
      picker.set(null);
    } catch (err) {
      say(userMessage(err));
    } finally {
      busy = false;
    }
  }
</script>

{#if track}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-pure-black/80"
    role="dialog"
    aria-modal="true"
    aria-label={$lang === 'ru' ? 'Добавить в плейлист' : 'Add to playlist'}
    tabindex="-1"
    onpointerdown={() => picker.set(null)}
  >
    <div
      class="w-96 rounded-2xl border border-line bg-pure-black p-6"
      role="presentation"
      onpointerdown={(e) => e.stopPropagation()}
    >
      <div class="mb-4 flex items-center justify-between">
        <span class="label">{$lang === 'ru' ? 'В плейлист' : 'To playlist'}</span>
        <button class="text-dim hover:text-pure-white" onclick={() => picker.set(null)} aria-label={$lang === 'ru' ? 'Закрыть' : 'Close'}>
          <Icon name="x" />
        </button>
      </div>

      <div class="mb-4 max-h-56 overflow-y-auto border-t border-line">
        {#each $myPlaylists as pl (pl.id)}
          <button
            class="flex w-full items-center justify-between border-b border-line px-2 py-2.5 text-left text-[13px] text-dim hover:text-pure-white"
            disabled={busy}
            onclick={() => add(pl.id)}
          >
            <span class="truncate">{pl.title}</span>
            <span class="text-[11px] tabular-nums">{pl.track_count}</span>
          </button>
        {:else}
          <div class="py-4 text-[12px] text-dim">{$lang === 'ru' ? 'Нет плейлистов' : 'No playlists'}</div>
        {/each}
      </div>

      <form class="flex gap-2" onsubmit={create}>
        <Input bind:value={newTitle} placeholder={$lang === 'ru' ? 'Новый плейлист' : 'New playlist'} class="flex-1" />
        <Button type="submit" variant="solid" disabled={busy || !newTitle.trim()}>
          {$lang === 'ru' ? 'Создать' : 'Create'}
        </Button>
      </form>
    </div>
  </div>
{/if}
