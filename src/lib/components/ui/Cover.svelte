<script lang="ts">  let { src, size = 48, alt = '', radius = 8 }: { src: string; size?: number; alt?: string; radius?: number } = $props();
  let currentSrc = $state('');
  let triedFallback = $state(false);
  let failed = $state(false);

  $effect(() => {
    currentSrc = src;
    triedFallback = false;
    failed = false;
  });

  function handleError() {
    if (!triedFallback && currentSrc && /-t\d+x\d+\./.test(currentSrc)) {
      triedFallback = true;
      currentSrc = currentSrc.replace(/-t\d+x\d+\./, '-large.');
      return;
    }
    failed = true;
  }
</script>

<div
  class="relative shrink-0 overflow-hidden bg-surface"
  style="{size ? `width:${size}px;height:${size}px;` : 'width:100%;height:100%;'}border-radius:{radius}px"
>
  {#if currentSrc && !failed}
    <img
      src={currentSrc}
      {alt}
      class="h-full w-full object-cover"
      loading="lazy"
      decoding="async"
      draggable="false"
      onerror={handleError}
    />
  {:else}
    <div
      class="flex h-full w-full items-center justify-center"
      style="background: radial-gradient(circle at 30% 25%, var(--accent-soft), var(--surface-2) 75%)"
    >
      <svg viewBox="0 0 24 24" class="h-2/5 w-2/5 opacity-45" fill="none" stroke="currentColor" stroke-width="1.6">
        <circle cx="12" cy="12" r="8" stroke-opacity="0.5" />
        <circle cx="12" cy="12" r="2.5" />
      </svg>
    </div>
  {/if}
</div>
