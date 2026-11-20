<script lang="ts">  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { ipc, isTauri } from '$lib/api/arima';
  import Icon from '$lib/components/ui/Icon.svelte';
  import { auth } from '$lib/stores/auth';
  import { lang, tr } from '$lib/i18n';
  import { settings } from '$lib/stores/settings';
  import { artwork } from '$lib/utils';

  let maximized = $state(false);
  let navEl: HTMLElement | undefined = $state();
  let navItemEls: Record<string, HTMLElement> = {};
  let pillX = $state(0);
  let pillW = $state(0);
  let pillReady = $state(false);

  const path = $derived(page.url.pathname + page.url.search);
  const currentPath = $derived(page.url.pathname);

  const nav = $derived([
    { href: '/', label: $tr.nav.home },
    { href: '/search', label: $tr.nav.search },
    { href: '/library', label: $tr.nav.library },
    { href: '/settings', label: $tr.nav.settings }
  ]);

  function isActive(href: string): boolean {
    if (href === '/') return currentPath === '/';
    if (href === '/search') return currentPath.startsWith('/search');
    if (href === '/library') return currentPath.startsWith('/library') || currentPath.startsWith('/playlist') || currentPath.startsWith('/artist');
    if (href === '/settings') return currentPath.startsWith('/settings');
    return false;
  }

  function updatePill() {
    const active = nav.find((item) => isActive(item.href));
    const el = active ? navItemEls[active.href] : undefined;
    if (!el || !navEl) {
      pillReady = false;
      return;
    }
    pillX = el.offsetLeft;
    pillW = el.offsetWidth;
    pillReady = true;
  }

  $effect(() => {
    void currentPath;
    queueMicrotask(updatePill);
  });

  onMount(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      maximized = await win.isMaximized();
      unlisten = await win.onResized(async () => {
        maximized = await win.isMaximized();
      });
    })();
    return () => unlisten?.();
  });

  async function minimize() {
    if (!isTauri) return;
    if ($settings.ui?.windowAnimations) {
      await ipc.app.minimizeFx();
      return;
    }
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().minimize();
  }

  async function toggleMax() {
    if (!isTauri) return;
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().toggleMaximize();
  }

  async function close() {
    if (!isTauri) return;
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().close();
  }
</script>

<header class="relative z-30 flex h-16 w-full shrink-0 items-center justify-between px-5" data-tauri-drag-region>
  <div class="flex items-center gap-2" data-tauri-drag-region>
    <div class="oled-pill flex items-center gap-0.5 rounded-full p-1">
      <button
        class="flex h-6 w-6 items-center justify-center rounded-full text-dim transition-colors hover:bg-hover hover:text-pure-white"
        onclick={() => history.back()}
        aria-label="Назад"
        title="Назад"
      >
        <Icon name="chevron-left" size={14} />
      </button>
      <button
        class="flex h-6 w-6 items-center justify-center rounded-full text-dim transition-colors hover:bg-hover hover:text-pure-white"
        onclick={() => history.forward()}
        aria-label="Вперёд"
        title="Вперёд"
      >
        <Icon name="chevron-right" size={14} />
      </button>
    </div>
    <span class="hidden text-[12px] font-semibold text-pure-white/55 sm:inline" data-tauri-drag-region>
      ARIMA
    </span>
  </div>

  <nav
    bind:this={navEl}
    class="oled-pill relative flex h-11 items-center gap-1 rounded-full px-2"
    aria-label="Навигация"
  >
    <a href="/" class="relative z-10 mr-2 flex h-7 w-7 items-center justify-center rounded-full bg-pure-white/10 transition-transform duration-200 hover:scale-105" aria-label="Arima">
      <div class="mask-logo h-4 w-4"></div>
    </a>

    <div class="relative flex items-center gap-1">
      {#if pillReady}
        <span
          class="accent-pill pointer-events-none absolute top-0 bottom-0 left-0 rounded-full transition-[transform,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style="transform: translate3d({pillX}px, 0, 0); width: {pillW}px"
          aria-hidden="true"
        ></span>
      {/if}

      {#each nav as item (item.href)}
        {@const active = isActive(item.href)}
        <a
          bind:this={navItemEls[item.href]}
          href={item.href}
          class="relative z-10 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-200 {active
            ? 'text-[var(--accent-fg)] font-semibold'
            : 'text-dim hover:text-pure-white'}"
        >
          {item.label}
        </a>
      {/each}
    </div>
  </nav>

  <div class="flex items-center gap-2">
    {#if $auth.user}
      <a
        href="/settings"
        title={$auth.user.username}
        class="h-7 w-7 overflow-hidden rounded-full border border-pure-white/20 bg-surface"
      >
        {#if $auth.user.avatar_url}
          <img src={artwork($auth.user.avatar_url, 't50x50')} alt="" class="h-full w-full object-cover" draggable="false" />
        {/if}
      </a>
    {:else}
      <a
        href="/login"
        class="rounded-full border border-pure-white/20 bg-pure-black/50 px-3 py-1 text-[11px] font-medium text-pure-white backdrop-blur-xl hover:bg-pure-white hover:text-pure-black"
      >
        {$lang === 'ru' ? 'Войти' : 'Sign in'}
      </a>
    {/if}

    <div class="oled-pill flex items-center gap-0.5 rounded-full px-1 py-0.5">
      <button
        class="flex h-6 w-7 items-center justify-center rounded-full text-dim hover:bg-hover hover:text-pure-white"
        onclick={minimize}
        aria-label={$lang === 'ru' ? 'Свернуть' : 'Minimize'}
      >
        <Icon name="minus" size={12} />
      </button>
      <button
        class="flex h-6 w-7 items-center justify-center rounded-full text-dim hover:bg-hover hover:text-pure-white"
        onclick={toggleMax}
        aria-label={maximized ? ($lang === 'ru' ? 'Восстановить' : 'Restore') : ($lang === 'ru' ? 'Развернуть' : 'Maximize')}
      >
        <Icon name={maximized ? 'restore' : 'maximize'} size={11} />
      </button>
      <button
        class="flex h-6 w-7 items-center justify-center rounded-full text-dim hover:bg-pure-white hover:text-pure-black"
        onclick={close}
        aria-label={$lang === 'ru' ? 'Закрыть' : 'Close'}
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  </div>
</header>
