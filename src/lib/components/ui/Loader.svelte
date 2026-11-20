<script lang="ts">
  import { lang } from '$lib/i18n';
  let { active = true }: { active?: boolean } = $props();
</script>

{#if active}
  <div class="relative h-px w-full overflow-hidden bg-line" role="progressbar" aria-label={$lang === 'ru' ? 'Загрузка' : 'Loading'}>
    <div class="loader absolute left-0 top-0 h-full w-1/4 bg-pure-white"></div>
  </div>
{/if}

<style>  .loader {
    animation: slide 1.1s cubic-bezier(0.6, 0, 0.4, 1) infinite;
  }
  @keyframes slide {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(400%);
    }
  }
</style>
