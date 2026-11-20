<script lang="ts">  import { onMount } from 'svelte';
  import { ipc, userMessage } from '$lib/api/arima';
  import EqPanel from '$lib/components/player/EqPanel.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import Slider from '$lib/components/ui/Slider.svelte';
  import Toggle from '$lib/components/ui/Toggle.svelte';
  import { get } from 'svelte/store';
  import { lang, tr } from '$lib/i18n';
  import { auth, logout } from '$lib/stores/auth';
  import { engine } from '$lib/stores/player';
  import {
    THEME_PALETTES,
    settings,
    updateSettings
  } from '$lib/stores/settings';
  import { say } from '$lib/stores/ui';
  import { artwork } from '$lib/utils';

  type TopTab = 'profile' | 'general' | 'interface';
  type GeneralSub = 'main' | 'audio' | 'cache' | 'overlay';

  let topTab = $state<TopTab>('general');
  let generalSub = $state<GeneralSub>('main');
  let devices = $state<MediaDeviceInfo[]>([]);
  let cacheStats = $state<{ bytes: number; files: number }>({ bytes: 0, files: 0 });
  let proxyDraft = $state($settings.proxy);
  let hotkeyDraft = $state($settings.island.toggleHotkey);
  let confirmReset = $state(false);
  let resetting = $state(false);

  $effect(() => {
    proxyDraft = $settings.proxy;
    hotkeyDraft = $settings.island.toggleHotkey;
  });

  async function refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      devices = list.filter((d) => d.kind === 'audiooutput');
    } catch {

    }
  }

  async function refreshCache() {
    cacheStats = await ipc.cache.stats().catch(() => ({ bytes: 0, files: 0 }));
  }

  onMount(() => {
    void refreshCache();
    void refreshDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices);
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices);
    };
  });

  async function clearCache() {
    await ipc.cache.clear().catch((e) => say(userMessage(e)));
    await refreshCache();
    say(get(lang) === 'ru' ? 'Кэш очищен' : 'Cache cleared');
  }

  async function resetApp() {
    if (resetting) return;
    resetting = true;
    try {
      engine.pause();
      await ipc.app.reset();
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {

      }
      location.replace('/onboarding');
    } catch (e) {
      say(userMessage(e));
      resetting = false;
      confirmReset = false;
    }
  }

  const topTabs = $derived<{ id: TopTab; label: string }[]>([
    { id: 'profile', label: $tr.settings.tabProfile },
    { id: 'general', label: $tr.settings.tabGeneral },
    { id: 'interface', label: $tr.settings.subTheme }
  ]);

  const subTabs = $derived<{ id: GeneralSub; label: string }[]>([
    { id: 'main', label: $tr.settings.subMain },
    { id: 'audio', label: $tr.settings.subAudio },
    { id: 'cache', label: $tr.settings.subCache },
    { id: 'overlay', label: $tr.settings.subIsland }
  ]);

  let topBarEl: HTMLElement | undefined = $state();
  let subBarEl: HTMLElement | undefined = $state();
  let themeBarEl: HTMLElement | undefined = $state();
  let topLine = $state({ x: 0, w: 0, show: false });
  let subPill = $state({ x: 0, w: 0, show: false });
  let themePill = $state({ x: 0, w: 0, show: false });

  $effect(() => {
    void topTab;
    void generalSub;
    const curTheme = $settings.ui.theme ?? 'dark';
    queueMicrotask(() => {
      const topEl = topBarEl?.querySelector<HTMLElement>(`[data-top="${topTab}"]`);
      if (topEl) topLine = { x: topEl.offsetLeft, w: topEl.offsetWidth, show: true };
      const subEl = subBarEl?.querySelector<HTMLElement>(`[data-sub="${generalSub}"]`);
      if (subEl) subPill = { x: subEl.offsetLeft, w: subEl.offsetWidth, show: true };
      else subPill = { ...subPill, show: false };
      const thEl = themeBarEl?.querySelector<HTMLElement>(`[data-theme-id="${curTheme}"]`);
      if (thEl) themePill = { x: thEl.offsetLeft, w: thEl.offsetWidth, show: true };
      else themePill = { ...themePill, show: false };
    });
  });
</script>

<div class="mx-auto max-w-3xl px-8 py-6">
  <div bind:this={topBarEl} class="relative mb-6 flex justify-center gap-8 border-b border-line">
    {#if topLine.show}
      <span
        class="pointer-events-none absolute bottom-0 left-0 h-[2px] rounded-full bg-pure-white transition-[transform,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
        style="transform: translate3d({topLine.x}px, 0, 0); width: {topLine.w}px"
        aria-hidden="true"
      ></span>
    {/if}
    {#each topTabs as t (t.id)}
      <button
        data-top={t.id}
        class="relative pb-3 text-[13px] font-medium transition-colors duration-200 {topTab === t.id
          ? 'text-pure-white'
          : 'text-dim hover:text-pure-white'}"
        onclick={() => (topTab = t.id)}
      >
        {t.label}
      </button>
    {/each}
  </div>

  {#if topTab === 'profile'}
    {#if $auth.user}
      <div class="flex items-center justify-between rounded-2xl border border-line bg-surface p-5">
        <div class="flex items-center gap-4">
          <div class="h-14 w-14 overflow-hidden rounded-full border border-line bg-pure-black">
            {#if $auth.user.avatar_url}
              <img src={artwork($auth.user.avatar_url, 't120x120')} alt="" class="h-full w-full object-cover" />
            {/if}
          </div>
          <div>
            <div class="text-[15px] font-semibold text-pure-white">{$auth.user.username}</div>
            <div class="text-[12px] text-dim">{$auth.user.permalink_url}</div>
          </div>
        </div>
        <Button onclick={() => void logout()}>{$lang === 'ru' ? 'Выйти' : 'Sign out'}</Button>
      </div>
    {:else}
      <div class="flex items-center justify-between rounded-2xl border border-line bg-surface p-5">
        <div>
          <div class="text-[14px] font-medium text-pure-white">
            {$lang === 'ru' ? 'Аккаунт не подключён' : 'Account not connected'}
          </div>
          <div class="text-[12px] text-dim">
            {$lang === 'ru'
              ? 'Подключите SoundCloud для синхронизации лайков и плейлистов'
              : 'Connect SoundCloud to sync your likes and playlists'}
          </div>
        </div>
        <a href="/login" class="rounded-full bg-pure-white px-5 py-2 text-[13px] font-medium text-pure-black">
          {$lang === 'ru' ? 'Войти' : 'Sign in'}
        </a>
      </div>
    {/if}
  {:else if topTab === 'general'}
    <div class="mb-8 flex justify-center">
      <div bind:this={subBarEl} class="relative inline-flex gap-1 rounded-full border border-line bg-surface p-1">
        {#if subPill.show}
          <span
            class="pointer-events-none absolute top-1 bottom-1 left-0 rounded-full bg-pure-white transition-[transform,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
            style="transform: translate3d({subPill.x}px, 0, 0); width: {subPill.w}px"
            aria-hidden="true"
          ></span>
        {/if}
        {#each subTabs as s (s.id)}
          <button
            data-sub={s.id}
            class="relative z-10 rounded-full px-4 py-1.5 text-[12px] font-medium transition-colors duration-200 {generalSub === s.id
              ? 'text-pure-black font-semibold'
              : 'text-dim hover:text-pure-white'}"
            onclick={() => (generalSub = s.id)}
          >
            {s.label}
          </button>
        {/each}
      </div>
    </div>

    {#if generalSub === 'main'}
      <div class="space-y-5">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-[14px] font-medium text-pure-white">{$tr.settings.language}</div>
            <div class="text-[12px] text-dim">{$tr.settings.languageDesc}</div>
          </div>
          <div class="inline-flex gap-1 rounded-full border border-line bg-surface p-1">
            <button
              class="rounded-full px-3.5 py-1 text-[12px] font-medium transition-colors {($settings.ui.language ?? 'en') === 'en'
                ? 'bg-pure-white text-pure-black font-semibold'
                : 'text-dim hover:text-pure-white'}"
              onclick={() => void updateSettings({ ui: { language: 'en' } })}
            >
              English
            </button>
            <button
              class="rounded-full px-3.5 py-1 text-[12px] font-medium transition-colors {$settings.ui.language === 'ru'
                ? 'bg-pure-white text-pure-black font-semibold'
                : 'text-dim hover:text-pure-white'}"
              onclick={() => void updateSettings({ ui: { language: 'ru' } })}
            >
              Русский
            </button>
          </div>
        </div>

        <div class="flex items-center justify-between">
          <div>
            <div class="text-[14px] font-medium text-pure-white">{$tr.settings.autostart}</div>
            <div class="text-[12px] text-dim">{$tr.settings.autostartDesc}</div>
          </div>
          <Toggle
            checked={$settings.autostart}
            label={$tr.settings.autostart}
            onchange={(v) => void updateSettings({ autostart: v })}
          />
        </div>

        <div class="flex items-center justify-between">
          <div>
            <div class="text-[14px] font-medium text-pure-white">{$tr.settings.closeToTray}</div>
            <div class="text-[12px] text-dim">{$tr.settings.closeToTrayDesc}</div>
          </div>
          <Toggle
            checked={$settings.closeToTray}
            label={$tr.settings.closeToTray}
            onchange={(v) => void updateSettings({ closeToTray: v })}
          />
        </div>

        <div class="flex items-center justify-between">
          <div>
            <div class="text-[14px] font-medium text-pure-white">{$tr.settings.startMinimized}</div>
            <div class="text-[12px] text-dim">{$tr.settings.startMinimizedDesc}</div>
          </div>
          <Toggle
            checked={$settings.startMinimized}
            label={$tr.settings.startMinimized}
            onchange={(v) => void updateSettings({ startMinimized: v })}
          />
        </div>

        <div class="flex items-center justify-between">
          <div>
            <div class="text-[14px] font-medium text-pure-white">{$tr.settings.discord}</div>
            <div class="text-[12px] text-dim">{$tr.settings.discordDesc}</div>
          </div>
          <Toggle
            checked={$settings.discordEnabled}
            label={$tr.settings.discord}
            onchange={(v) => void updateSettings({ discordEnabled: v })}
          />
        </div>

        <div class="border-t border-line pt-5 space-y-5">
          <div class="flex items-center justify-between">
            <div>
              <div class="text-[14px] font-medium text-pure-white">{$tr.settings.hideDupes}</div>
              <div class="text-[12px] text-dim">{$tr.settings.hideDupesDesc}</div>
            </div>
            <Toggle
              checked={$settings.ui.hideDuplicates ?? true}
              label={$tr.settings.hideDupes}
              onchange={(v) => void updateSettings({ ui: { hideDuplicates: v } })}
            />
          </div>

          <div class="flex items-center justify-between">
            <div>
              <div class="text-[14px] font-medium text-pure-white">{$tr.settings.hideRemixes}</div>
              <div class="text-[12px] text-dim">{$tr.settings.hideRemixesDesc}</div>
            </div>
            <Toggle
              checked={$settings.ui.hideRemixes ?? false}
              label={$tr.settings.hideRemixes}
              onchange={(v) => void updateSettings({ ui: { hideRemixes: v } })}
            />
          </div>
        </div>
      </div>
    {:else if generalSub === 'audio'}
      <div class="space-y-6">
        <div class="rounded-2xl border border-line bg-surface p-4">
          <div class="mb-3 flex items-center justify-between gap-3">
            <div>
              <div class="text-[14px] font-semibold text-pure-white">
                {$lang === 'ru' ? 'Устройство вывода звука' : 'Audio output device'}
              </div>
              <div class="text-[12px] text-dim">
                {$lang === 'ru' ? 'Выберите активное аудиоустройство Windows' : 'Select active Windows audio output device'}
              </div>
            </div>
            <Button onclick={() => void refreshDevices()}>{$lang === 'ru' ? 'Обновить' : 'Refresh'}</Button>
          </div>

          <select
            class="h-10 w-full rounded-xl border border-line bg-pure-black/60 px-3 text-[13px] text-pure-white"
            value={$settings.audio.outputDeviceId ?? ''}
            onchange={(e) => {
              const id = e.currentTarget.value;
              void engine.setOutputDevice(id);
              void updateSettings({ audio: { outputDeviceId: id } });
            }}
          >
            <option value="">{$lang === 'ru' ? 'По умолчанию (системное устройство)' : 'Default (system device)'}</option>
            {#each devices.filter((d) => d.deviceId && d.deviceId !== 'default') as d, idx (d.deviceId)}
              <option value={d.deviceId}>
                {d.label || ($lang === 'ru' ? `Устройство вывода #${idx + 1}` : `Output device #${idx + 1}`)}
              </option>
            {/each}
          </select>
        </div>

        <div class="border-t border-line pt-5">
          <div class="mb-3 text-[14px] font-semibold text-pure-white">
            {$lang === 'ru' ? 'Настройки звука' : 'Audio settings'}
          </div>
          <EqPanel />
        </div>
      </div>
    {:else if generalSub === 'cache'}
      <div class="space-y-5">
        <div class="flex items-center justify-between rounded-2xl border border-line bg-surface p-4">
          <div>
            <div class="text-[14px] font-medium text-pure-white">
              {$lang === 'ru' ? 'Аудио-кэш:' : 'Audio cache:'} {(cacheStats.bytes / (1024 * 1024)).toFixed(1)} {$lang === 'ru' ? 'МБ' : 'MB'}
            </div>
            <div class="text-[12px] text-dim">
              {cacheStats.files} {$lang === 'ru' ? 'файлов · лимит' : 'files · limit'} {$settings.cacheMaxMb} {$lang === 'ru' ? 'МБ' : 'MB'}
            </div>
          </div>
          <Button onclick={clearCache}>{$lang === 'ru' ? 'Очистить' : 'Clear'}</Button>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-red-500/25 bg-surface p-4">
          <div>
            <div class="text-[14px] font-medium text-pure-white">
              {$lang === 'ru' ? 'Полный сброс приложения' : 'Full app reset'}
            </div>
            <div class="text-[12px] text-dim">
              {$lang === 'ru'
                ? 'Удалит настройки, историю, кэш, данные WebView и выйдет из аккаунта SoundCloud'
                : 'Deletes settings, history, cache, WebView data and signs out of SoundCloud'}
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            {#if confirmReset}
              <Button
                class="!border-red-500/50 !bg-red-500/20 !text-red-200 hover:!bg-red-500/30"
                disabled={resetting}
                onclick={resetApp}
              >
                {resetting
                  ? ($lang === 'ru' ? 'Сброс...' : 'Resetting...')
                  : ($lang === 'ru' ? 'Подтвердить сброс' : 'Confirm reset')}
              </Button>
              <Button variant="ghost" disabled={resetting} onclick={() => (confirmReset = false)}>
                {$lang === 'ru' ? 'Отмена' : 'Cancel'}
              </Button>
            {:else}
              <Button
                class="!border-red-500/35 !text-red-300 hover:!bg-red-500/15"
                onclick={() => (confirmReset = true)}
              >
                {$lang === 'ru' ? 'Сбросить Arima' : 'Reset Arima'}
              </Button>
            {/if}
          </div>
        </div>

        <div class="flex items-end gap-3">
          <Input
            bind:value={proxyDraft}
            label={$lang === 'ru' ? 'Прокси (http://host:port или socks5://host:port)' : 'Proxy (http://host:port or socks5://host:port)'}
            placeholder={$lang === 'ru' ? 'Пусто — напрямую' : 'Empty — direct connection'}
            class="flex-1"
          />
          <Button onclick={() => void updateSettings({ proxy: proxyDraft.trim() })}>
            {$lang === 'ru' ? 'Сохранить' : 'Save'}
          </Button>
        </div>
      </div>
    {:else}
      <div class="space-y-5">
        <div>
          <div class="mb-2 text-[12px] font-medium text-dim">
            {$lang === 'ru' ? 'Стиль оверлея' : 'Overlay style'}
          </div>
          <div class="grid grid-cols-3 gap-3">
            {#each [
              ['island', 'Dynamic Island', $lang === 'ru' ? 'Капсула, раскрывается при наведении' : 'Capsule, expands on hover'],
              ['pill', $lang === 'ru' ? 'Пилюля' : 'Pill', $lang === 'ru' ? 'Компактная полоса с кнопками' : 'Compact bar with controls'],
              ['mini', $lang === 'ru' ? 'Мини-плеер' : 'Mini player', $lang === 'ru' ? 'Всегда развёрнутая карточка' : 'Always expanded card']
            ] as [id, title, desc] (id)}
              <button
                class="rounded-xl border p-3.5 text-left transition-colors {$settings.island.style === id
                  ? 'border-pure-white bg-surface-2'
                  : 'border-line bg-surface hover:bg-hover'}"
                onclick={() => void updateSettings({ island: { style: id as 'island' | 'pill' | 'mini' } })}
              >
                <div class="text-[13px] font-medium text-pure-white">{title}</div>
                <div class="mt-0.5 text-[11px] text-dim">{desc}</div>
              </button>
            {/each}
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <label class="block">
            <span class="mb-2 block text-[12px] font-medium text-dim">
              {$lang === 'ru' ? 'Режим Dynamic Island' : 'Dynamic Island mode'}
            </span>
            <select
              class="h-10 w-full rounded-xl border border-line bg-surface px-3 text-[13px] text-pure-white"
              value={$settings.island.mode}
              onchange={(e) =>
                void updateSettings({ island: { mode: e.currentTarget.value as 'always' | 'transient' | 'off' } })}
            >
              <option value="always">
                {$lang === 'ru' ? 'Пока играет (когда окно свёрнуто)' : 'While playing (when minimized)'}
              </option>
              <option value="transient">
                {$lang === 'ru' ? 'Всплывать при смене трека' : 'Show on track change'}
              </option>
              <option value="off">{$lang === 'ru' ? 'Выключен' : 'Off'}</option>
            </select>
          </label>

          <label class="block">
            <span class="mb-2 block text-[12px] font-medium text-dim">
              {$lang === 'ru' ? 'Позиция' : 'Position'}
            </span>
            <select
              class="h-10 w-full rounded-xl border border-line bg-surface px-3 text-[13px] text-pure-white"
              value={$settings.island.position}
              onchange={(e) =>
                void updateSettings({
                  island: {
                    position: e.currentTarget.value as 'top-center' | 'top-left' | 'top-right' | 'bottom-center'
                  }
                })}
            >
              <option value="top-center">{$lang === 'ru' ? 'Сверху по центру' : 'Top center'}</option>
              <option value="top-left">{$lang === 'ru' ? 'Сверху слева' : 'Top left'}</option>
              <option value="top-right">{$lang === 'ru' ? 'Сверху справа' : 'Top right'}</option>
              <option value="bottom-center">{$lang === 'ru' ? 'Снизу по центру' : 'Bottom center'}</option>
            </select>
          </label>
        </div>

        <div class="flex items-center justify-between">
          <div>
            <div class="text-[14px] font-medium text-pure-white">
              {$lang === 'ru' ? 'Скрывать в полноэкранных играх и видео' : 'Hide in fullscreen games & video'}
            </div>
            <div class="text-[12px] text-dim">
              {$lang === 'ru'
                ? 'Оверлей автоматически прячется при запуске полноэкранных окон'
                : 'Overlay hides automatically when fullscreen windows are active'}
            </div>
          </div>
          <Toggle
            checked={$settings.island.hideInFullscreen}
            label={$lang === 'ru' ? 'Скрывать в полноэкранном режиме' : 'Hide in fullscreen'}
            onchange={(v) => void updateSettings({ island: { hideInFullscreen: v } })}
          />
        </div>

        <div class="flex items-end gap-3">
          <Input bind:value={hotkeyDraft} label={$lang === 'ru' ? 'Горячая клавиша скрытия' : 'Toggle hotkey'} class="flex-1" />
          <Button onclick={() => void updateSettings({ island: { toggleHotkey: hotkeyDraft.trim() } })}>
            {$lang === 'ru' ? 'Применить' : 'Apply'}
          </Button>
        </div>
      </div>
    {/if}
  {:else if topTab === 'interface'}
    <div class="space-y-6">
      <div class="oled-card space-y-6 rounded-2xl p-6">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div class="text-[14px] font-semibold text-pure-white">{$lang === 'ru' ? 'Тема' : 'Theme'}</div>
            <div class="mt-0.5 text-[12px] text-dim">
              {$lang === 'ru' ? 'Тёмный, светлый или как в системе' : 'Dark, light, or follow system'}
            </div>
          </div>

          <div bind:this={themeBarEl} class="relative inline-flex rounded-full bg-surface p-1" style="box-shadow: inset 0 0 0 1px var(--line)">
            {#if themePill.show}
              <span
                class="pointer-events-none absolute top-1 bottom-1 left-0 rounded-full bg-pure-white transition-[transform,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                style="transform: translate3d({themePill.x}px, 0, 0); width: {themePill.w}px"
                aria-hidden="true"
              ></span>
            {/if}
            {#each [
              ['dark', $lang === 'ru' ? 'Тёмная' : 'Dark'],
              ['light', $lang === 'ru' ? 'Светлая' : 'Light'],
              ['system', $lang === 'ru' ? 'Системная' : 'System']
            ] as [id, label] (id)}
              {@const active = ($settings.ui.theme ?? 'dark') === id}
              <button
                data-theme-id={id}
                class="relative z-10 rounded-full px-4 py-1.5 text-[12px] font-medium transition-colors duration-200 {active
                  ? 'text-pure-black font-semibold'
                  : 'text-dim hover:text-pure-white'}"
                onclick={() => void updateSettings({ ui: { theme: id as 'dark' | 'light' | 'system' } })}
              >
                {label}
              </button>
            {/each}
          </div>
        </div>

        <div>
          <div class="mb-3">
            <div class="text-[14px] font-semibold text-pure-white">{$lang === 'ru' ? 'Цвет' : 'Color'}</div>
            <div class="mt-0.5 text-[12px] text-dim">
              {$lang === 'ru' ? 'Готовые палитры, цвета обложки или своя тема' : 'Preset palettes, cover art colors, or custom theme'}
            </div>
          </div>

          <div class="scroll-x flex gap-3 pb-2">
            {#each THEME_PALETTES as p (p.id)}
              {@const active = ($settings.ui.accentPreset ?? 'amoled') === p.id}
              <button
                class="group flex w-[112px] shrink-0 flex-col items-center gap-2 text-center"
                onclick={() => void updateSettings({ ui: { accentPreset: p.id } })}
              >
                <div
                  class="flex h-16 w-full gap-1.5 rounded-2xl p-2 transition-shadow"
                  style="background:{p.bg}; box-shadow: inset 0 0 0 {active ? '2px var(--accent)' : '1px rgba(255,255,255,0.12)'}"
                >
                  <div class="h-full w-3 rounded-lg bg-pure-white/[0.06]"></div>
                  <div class="flex flex-1 flex-col gap-1.5 rounded-xl bg-pure-white/[0.04] p-2">
                    <div class="h-1.5 w-10 rounded-full bg-pure-white/30"></div>
                    <div
                      class="h-1.5 w-7 rounded-full"
                      style="background:{p.gradient ? `linear-gradient(90deg, ${p.c1}, ${p.c2})` : p.c1}"
                    ></div>
                  </div>
                </div>
                <span class="text-[12px] {active ? 'font-semibold text-pure-white' : 'text-dim group-hover:text-pure-white'}">
                  {p.id === 'track' ? ($lang === 'ru' ? 'Под трек' : 'Track colors') : p.label}
                </span>
              </button>
            {/each}

            <button
              class="group flex w-[112px] shrink-0 flex-col items-center gap-2 text-center"
              onclick={() => void updateSettings({ ui: { accentPreset: 'custom' } })}
            >
              <div
                class="flex h-16 w-full gap-1.5 rounded-2xl p-2 transition-shadow"
                style="background:{$settings.ui.customAccent2 || '#000000'}; box-shadow: inset 0 0 0 {$settings.ui.accentPreset === 'custom' ? '2px var(--accent)' : '1px rgba(255,255,255,0.12)'}"
              >
                <div class="h-full w-3 rounded-lg bg-pure-white/[0.06]"></div>
                <div class="flex flex-1 flex-col gap-1.5 rounded-xl bg-pure-white/[0.04] p-2">
                  <div class="h-1.5 w-10 rounded-full bg-pure-white/30"></div>
                  <div
                    class="h-1.5 w-7 rounded-full"
                    style="background:{$settings.ui.customAccent || '#ffffff'}"
                  ></div>
                </div>
              </div>
              <span class="text-[12px] {$settings.ui.accentPreset === 'custom' ? 'font-semibold text-pure-white' : 'text-dim group-hover:text-pure-white'}">
                {$lang === 'ru' ? 'Своя' : 'Custom'}
              </span>
            </button>
          </div>

          {#if $settings.ui.accentPreset === 'custom'}
            <div class="mt-3 flex flex-wrap items-center gap-2.5">
              <input
                type="text"
                class="h-9 w-40 rounded-full bg-surface px-3.5 text-[12px] text-pure-white placeholder:text-dim"
                style="box-shadow: inset 0 0 0 1px var(--line)"
                placeholder={$lang === 'ru' ? 'Моя тема' : 'My theme'}
                value={$settings.ui.customThemeName ?? ($lang === 'ru' ? 'Моя тема' : 'My theme')}
                onchange={(e) => void updateSettings({ ui: { customThemeName: e.currentTarget.value } })}
              />

              <label
                class="inline-flex h-9 cursor-pointer items-center gap-2 rounded-full bg-surface px-3 text-[12px] text-pure-white hover:bg-surface-2"
                style="box-shadow: inset 0 0 0 1px var(--line)"
              >
                <span
                  class="h-4 w-4 rounded-full"
                  style="background:{$settings.ui.customAccent2 || '#000000'}; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.25)"
                ></span>
                <span>{$lang === 'ru' ? 'Фон' : 'Background'}</span>
                <input
                  type="color"
                  class="sr-only"
                  value={$settings.ui.customAccent2 || '#000000'}
                  oninput={(e) => void updateSettings({ ui: { customAccent2: e.currentTarget.value } })}
                />
              </label>

              <label
                class="inline-flex h-9 cursor-pointer items-center gap-2 rounded-full bg-surface px-3 text-[12px] text-pure-white hover:bg-surface-2"
                style="box-shadow: inset 0 0 0 1px var(--line)"
              >
                <span
                  class="h-4 w-4 rounded-full"
                  style="background:{$settings.ui.customAccent || '#ffffff'}; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.25)"
                ></span>
                <span>{$lang === 'ru' ? 'Акцент' : 'Accent'}</span>
                <input
                  type="color"
                  class="sr-only"
                  value={$settings.ui.customAccent || '#ffffff'}
                  oninput={(e) => void updateSettings({ ui: { customAccent: e.currentTarget.value } })}
                />
              </label>

              <button
                class="flex h-9 w-9 items-center justify-center rounded-full text-dim hover:bg-surface hover:text-pure-white"
                title={$lang === 'ru' ? 'Сбросить свой стиль' : 'Reset custom style'}
                onclick={() =>
                  void updateSettings({
                    ui: { accentPreset: 'amoled', customAccent: '#ffffff', customAccent2: '#000000' }
                  })}
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          {/if}
        </div>
      </div>

      <div class="oled-card flex items-center justify-between rounded-2xl p-6">
        <div>
          <div class="text-[14px] font-semibold text-pure-white">
            {$lang === 'ru' ? 'Анимации окна частицами' : 'Particle window animations'}
          </div>
          <div class="mt-0.5 text-[12px] text-dim">
            {$lang === 'ru'
              ? 'Светлячки в цвете темы при открытии, сворачивании в панель задач и закрытии'
              : 'Theme-colored fireflies when opening, minimizing to taskbar, and closing'}
          </div>
        </div>
        <Toggle
          checked={$settings.ui.windowAnimations ?? false}
          label={$lang === 'ru' ? 'Анимации окна частицами' : 'Particle window animations'}
          onchange={(v) => void updateSettings({ ui: { windowAnimations: v } })}
        />
      </div>
    </div>
  {/if}

  <div class="mt-12 flex items-center gap-2.5 border-t border-line pt-6 text-[12px] text-dim">
    <div class="mask-logo h-4 w-4"></div>
    <span class="font-medium text-pure-white">Arima</span>
    <span>0.1.0</span>
  </div>
</div>
