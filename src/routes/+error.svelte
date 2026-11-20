<script lang="ts">
  import { page } from '$app/state';
  import Button from '$lib/components/ui/Button.svelte';
  import { lang } from '$lib/i18n';
</script>

<div class="flex h-full flex-col items-center justify-center p-8 text-center">
  <div class="mb-2 text-[20px] font-semibold text-pure-white">
    {$lang === 'ru' ? 'Ошибка' : 'Error'} {page.status}
  </div>
  <div class="mb-6 max-w-md text-[13px] text-dim">
    {page.error?.message ?? ($lang === 'ru' ? 'Неизвестная ошибка' : 'Unknown error')}
  </div>
  <Button variant="solid" onclick={() => location.assign('/')}>
    {$lang === 'ru' ? 'На главную' : 'Go home'}
  </Button>
</div>
