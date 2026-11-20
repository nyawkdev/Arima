<script lang="ts">  let { checked, onchange, label = '' }: { checked: boolean; onchange: (v: boolean) => void; label?: string } = $props();
</script>

<button
  type="button"
  role="switch"
  aria-checked={checked}
  aria-label={label}
  onclick={() => onchange(!checked)}
  style={checked ? 'background: var(--accent-bg); box-shadow: 0 0 14px var(--accent-glow)' : ''}
  class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-all {checked
    ? ''
    : 'bg-surface-2'}"
>
  <span
    style={checked ? 'background: var(--accent-fg)' : ''}
    class="inline-block h-4 w-4 rounded-full transition-transform {checked
      ? 'translate-x-6'
      : 'translate-x-1 bg-dim'}"
  ></span>
</button>
