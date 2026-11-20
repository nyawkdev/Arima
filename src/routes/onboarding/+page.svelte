<script lang="ts">
  import { goto } from '$app/navigation';
  import { fly } from 'svelte/transition';
  import { lang, tr } from '$lib/i18n';
  import { auth, login } from '$lib/stores/auth';
  import { settings, THEME_PALETTES, updateSettings } from '$lib/stores/settings';
  import { artwork } from '$lib/utils';
  import Button from '$lib/components/ui/Button.svelte';
  import Toggle from '$lib/components/ui/Toggle.svelte';

  let step = $state(0);
  let token = $state('');
  let overlayEnabled = $state(($settings.island.mode ?? 'always') !== 'off');
  let particleAnim = $state($settings.ui.windowAnimations ?? false);
  let discordSync = $state($settings.discordEnabled ?? true);
  let finishing = $state(false);

  const curLang = $derived($settings.ui.language ?? 'en');
  const curTheme = $derived($settings.ui.theme ?? 'dark');
  const curPreset = $derived($settings.ui.accentPreset ?? 'amoled');

  async function setLanguage(lang: 'en' | 'ru') {
    await updateSettings({ ui: { language: lang } });
  }

  async function connectToken() {
    const clean = token.trim();
    if (!clean || $auth.busy) return;
    await login(clean);
  }

  async function finish() {
    if (finishing) return;
    finishing = true;
    await updateSettings({
      discordEnabled: discordSync,
      island: { mode: overlayEnabled ? 'always' : 'off' },
      ui: {
        windowAnimations: particleAnim,
        onboardingDone: true
      }
    });
    await goto('/');
  }
</script>

<div class="relative flex h-screen w-screen flex-col items-center justify-center overflow-hidden bg-pure-black px-6 py-8">
  <div class="w-full max-w-xl">
    <div class="mb-6 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="mask-logo h-6 w-6"></div>
        <span class="text-[16px] font-semibold text-pure-white">Arima</span>
      </div>
      <div class="flex items-center gap-1.5">
        {#each [0, 1, 2] as idx (idx)}
          <span
            class="h-1.5 rounded-full transition-[width,background-color] duration-300 {step === idx
              ? 'w-6 bg-pure-white'
              : idx < step
                ? 'w-2 bg-pure-white/55'
                : 'w-2 bg-pure-white/20'}"
          ></span>
        {/each}
      </div>
    </div>

    <div class="oled-card rounded-3xl p-8">
      {#if step === 0}
        <div in:fly={{ y: 12, duration: 220 }}>
          <h1 class="text-[22px] font-semibold text-pure-white">{$tr.onboarding.step1Title}</h1>
          <p class="mt-1 text-[13px] text-dim">{$tr.onboarding.step1Desc}</p>

          <div class="mt-6 space-y-5">
            <div>
              <div class="mb-2 text-[12px] font-medium text-dim">{$tr.onboarding.langLabel}</div>
              <div class="grid grid-cols-2 gap-2">
                <button
                  class="flex items-center justify-between rounded-xl border px-4 py-3 text-[13px] font-medium transition-colors {curLang === 'en'
                    ? 'border-pure-white bg-pure-white text-pure-black font-semibold'
                    : 'border-line bg-surface text-pure-white hover:bg-hover'}"
                  onclick={() => void setLanguage('en')}
                >
                  <span>English</span>
                  <span class="text-[11px] opacity-70">Default</span>
                </button>
                <button
                  class="flex items-center justify-between rounded-xl border px-4 py-3 text-[13px] font-medium transition-colors {curLang === 'ru'
                    ? 'border-pure-white bg-pure-white text-pure-black font-semibold'
                    : 'border-line bg-surface text-pure-white hover:bg-hover'}"
                  onclick={() => void setLanguage('ru')}
                >
                  <span>Русский</span>
                  <span class="text-[11px] opacity-70">RU</span>
                </button>
              </div>
            </div>

            <div>
              <div class="mb-2 text-[12px] font-medium text-dim">{$tr.onboarding.themeLabel}</div>
              <div class="grid grid-cols-3 gap-2">
                {#each [
                  ['dark', $tr.settings.themeDark],
                  ['light', $tr.settings.themeLight],
                  ['system', $tr.settings.themeSystem]
                ] as [id, label] (id)}
                  <button
                    class="rounded-xl border px-3 py-2.5 text-[13px] font-medium transition-colors {curTheme === id
                      ? 'border-pure-white bg-pure-white text-pure-black font-semibold'
                      : 'border-line bg-surface text-dim hover:text-pure-white'}"
                    onclick={() => void updateSettings({ ui: { theme: id as 'dark' | 'light' | 'system' } })}
                  >
                    {label}
                  </button>
                {/each}
              </div>
            </div>

            <div>
              <div class="mb-2 text-[12px] font-medium text-dim">{$tr.onboarding.paletteLabel}</div>
              <div class="scroll-x flex gap-2.5 pb-1">
                {#each THEME_PALETTES as p (p.id)}
                  {@const active = curPreset === p.id}
                  <button
                    class="flex w-24 shrink-0 flex-col items-center gap-1.5"
                    onclick={() => void updateSettings({ ui: { accentPreset: p.id } })}
                  >
                    <div
                      class="flex h-12 w-full gap-1 rounded-xl p-1.5 transition-shadow"
                      style="background:{p.bg}; box-shadow: inset 0 0 0 {active ? '2px var(--accent)' : '1px rgba(255,255,255,0.12)'}"
                    >
                      <div class="h-full w-2.5 rounded bg-pure-white/[0.06]"></div>
                      <div class="flex flex-1 flex-col gap-1 rounded bg-pure-white/[0.04] p-1.5">
                        <div class="h-1 w-7 rounded-full bg-pure-white/30"></div>
                        <div
                          class="h-1 w-5 rounded-full"
                          style="background:{p.gradient ? `linear-gradient(90deg, ${p.c1}, ${p.c2})` : p.c1}"
                        ></div>
                      </div>
                    </div>
                    <span class="text-[11px] {active ? 'font-semibold text-pure-white' : 'text-dim'}">
                      {p.id === 'track' ? ($lang === 'ru' ? 'Под трек' : 'Track colors') : p.label}
                    </span>
                  </button>
                {/each}
              </div>
            </div>
          </div>
        </div>
      {:else if step === 1}
        <div in:fly={{ y: 12, duration: 220 }}>
          <h1 class="text-[22px] font-semibold text-pure-white">{$tr.onboarding.step2Title}</h1>
          <p class="mt-1 text-[13px] text-dim">{$tr.onboarding.step2Desc}</p>

          <div class="mt-6 space-y-4">
            {#if $auth.status === 'authenticated' && $auth.user}
              <div class="flex items-center gap-3.5 rounded-2xl border border-line bg-surface p-4">
                <div class="h-12 w-12 shrink-0 overflow-hidden rounded-full border border-line bg-pure-black">
                  {#if $auth.user.avatar_url}
                    <img src={artwork($auth.user.avatar_url, 't120x120')} alt="" class="h-full w-full object-cover" />
                  {/if}
                </div>
                <div class="min-w-0 flex-1">
                  <div class="text-[11px] text-dim">{$tr.onboarding.connectedAs}</div>
                  <div class="truncate text-[14px] font-semibold text-pure-white">{$auth.user.username}</div>
                </div>
              </div>
            {:else}
              <div class="flex gap-2">
                <input
                  type="password"
                  bind:value={token}
                  placeholder={$tr.onboarding.tokenPlaceholder}
                  class="flex-1 rounded-xl border border-line bg-surface px-4 py-3 text-[13px] text-pure-white placeholder:text-faint focus:border-pure-white/40"
                />
                <Button variant="solid" disabled={!token.trim() || $auth.busy} onclick={() => void connectToken()}>
                  {$auth.busy ? $tr.onboarding.connectingBtn : $tr.onboarding.connectBtn}
                </Button>
              </div>
              {#if $auth.error}
                <div class="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2 text-[12px] text-red-300">
                  {$auth.error}
                </div>
              {/if}
              <p class="text-[12px] text-faint">{$tr.onboarding.skipHint}</p>
            {/if}
          </div>
        </div>
      {:else}
        <div in:fly={{ y: 12, duration: 220 }}>
          <h1 class="text-[22px] font-semibold text-pure-white">{$tr.onboarding.step3Title}</h1>
          <p class="mt-1 text-[13px] text-dim">{$tr.onboarding.step3Desc}</p>

          <div class="mt-6 space-y-3">
            <div class="flex items-center justify-between gap-4 rounded-2xl border border-line bg-surface px-4 py-3.5">
              <div>
                <div class="text-[14px] font-medium text-pure-white">{$tr.onboarding.featIslandTitle}</div>
                <div class="text-[12px] text-dim">{$tr.onboarding.featIslandDesc}</div>
              </div>
              <Toggle
                checked={overlayEnabled}
                label={$tr.onboarding.featIslandTitle}
                onchange={(v) => (overlayEnabled = v)}
              />
            </div>

            <div class="flex items-center justify-between gap-4 rounded-2xl border border-line bg-surface px-4 py-3.5">
              <div>
                <div class="text-[14px] font-medium text-pure-white">{$tr.onboarding.featAnimTitle}</div>
                <div class="text-[12px] text-dim">{$tr.onboarding.featAnimDesc}</div>
              </div>
              <Toggle
                checked={particleAnim}
                label={$tr.onboarding.featAnimTitle}
                onchange={(v) => (particleAnim = v)}
              />
            </div>

            <div class="flex items-center justify-between gap-4 rounded-2xl border border-line bg-surface px-4 py-3.5">
              <div>
                <div class="text-[14px] font-medium text-pure-white">{$tr.onboarding.featDiscordTitle}</div>
                <div class="text-[12px] text-dim">{$tr.onboarding.featDiscordDesc}</div>
              </div>
              <Toggle
                checked={discordSync}
                label={$tr.onboarding.featDiscordTitle}
                onchange={(v) => (discordSync = v)}
              />
            </div>
          </div>
        </div>
      {/if}

      <div class="mt-8 flex items-center justify-between gap-3">
        {#if step > 0}
          <Button variant="ghost" onclick={() => (step -= 1)}>{$tr.onboarding.back}</Button>
        {:else}
          <span></span>
        {/if}

        {#if step < 2}
          <Button variant="solid" onclick={() => (step += 1)}>{$tr.onboarding.next}</Button>
        {:else}
          <Button variant="solid" disabled={finishing} onclick={() => void finish()}>
            {$tr.onboarding.start}
          </Button>
        {/if}
      </div>
    </div>
  </div>
</div>
