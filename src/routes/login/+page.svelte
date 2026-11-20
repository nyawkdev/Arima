<script lang="ts">  import { goto } from '$app/navigation';
  import Button from '$lib/components/ui/Button.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import { lang } from '$lib/i18n';
  import { auth, login } from '$lib/stores/auth';

  let token = $state('');

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!token.trim()) return;
    if (await login(token.trim())) {
      await goto('/');
    }
  }
</script>

<div class="mx-auto flex h-full max-w-lg flex-col justify-center px-8 py-12">
  <div class="mb-8 flex items-center gap-4">
    <div class="mask-logo h-9 w-9" aria-hidden="true"></div>
    <div>
      <h1 class="text-[22px] font-medium tracking-tight text-pure-white">
        {$lang === 'ru' ? 'Вход в SoundCloud' : 'Sign in to SoundCloud'}
      </h1>
      <p class="text-[12px] text-dim">
        {$lang === 'ru'
          ? 'Токен сохраняется локально в Windows Credential Manager'
          : 'Token is stored locally in Windows Credential Manager'}
      </p>
    </div>
  </div>

  <form class="flex flex-col gap-4 border border-line p-6" onsubmit={submit}>
    <Input
      bind:value={token}
      type="password"
      label={$lang === 'ru' ? 'OAuth токен (cookie oauth_token)' : 'OAuth token (oauth_token cookie)'}
      placeholder="2-xxxxxx-xxxxxxxx-xxxxxxxxxxxxxx"
      autocomplete="off"
    />

    {#if $auth.error}
      <div class="border border-line px-3 py-2 text-[12px] text-pure-white">{$auth.error}</div>
    {/if}

    <div class="flex items-center justify-between pt-2">
      <a href="/" class="text-[12px] text-dim hover:text-pure-white">
        {$lang === 'ru' ? 'Продолжить без входа' : 'Continue without signing in'}
      </a>
      <Button type="submit" variant="solid" disabled={$auth.busy || !token.trim()}>
        {$auth.busy
          ? ($lang === 'ru' ? 'Проверка...' : 'Checking...')
          : ($lang === 'ru' ? 'Войти' : 'Sign in')}
      </Button>
    </div>
  </form>

  <div class="mt-6 border border-line p-5 text-[12px] leading-relaxed text-dim">
    <div class="label mb-2">{$lang === 'ru' ? 'Как получить oauth_token' : 'How to get oauth_token'}</div>
    <ol class="list-decimal space-y-1 pl-4">
      {#if $lang === 'ru'}
        <li>Откройте soundcloud.com в браузере и войдите в аккаунт.</li>
        <li>Откройте DevTools (F12) → Application → Cookies → https://soundcloud.com.</li>
        <li>Скопируйте значение cookie <span class="text-pure-white">oauth_token</span>.</li>
      {:else}
        <li>Open soundcloud.com in your browser and sign in to your account.</li>
        <li>Open DevTools (F12) → Application → Cookies → https://soundcloud.com.</li>
        <li>Copy the value of the <span class="text-pure-white">oauth_token</span> cookie.</li>
      {/if}
    </ol>
  </div>
</div>
