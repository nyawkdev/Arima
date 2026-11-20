<script lang="ts">  import type { HTMLInputAttributes } from 'svelte/elements';

  interface Props extends HTMLInputAttributes {
    value?: string;
    label?: string;
  }

  let { value = $bindable(''), label, class: cls = '', ...rest }: Props = $props();
</script>

<label class="block {cls}">
  {#if label}<span class="mb-2 block text-[12px] font-medium text-dim">{label}</span>{/if}
  <input
    bind:value
    class="h-10 w-full rounded-xl border border-line bg-surface px-3.5 text-[13px] text-pure-white placeholder:text-faint focus:border-pure-white/40"
    {...rest}
  />
</label>
