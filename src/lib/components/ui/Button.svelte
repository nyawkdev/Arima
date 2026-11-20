<script lang="ts">  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  interface Props extends HTMLButtonAttributes {
    variant?: 'solid' | 'outline' | 'ghost';
    square?: boolean;
    active?: boolean;
    children: Snippet;
  }

  let { variant = 'outline', square = false, active = false, children, class: cls = '', ...rest }: Props = $props();
</script>

<button
  class="inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full text-[13px] font-medium transition-all duration-150 disabled:pointer-events-none disabled:opacity-35
    {square ? 'h-9 w-9' : 'h-9 px-5'}
    {variant === 'solid' ? 'accent-surface hover:opacity-90 active:scale-[0.98]' : ''}
    {variant === 'outline' ? 'oled-pill text-pure-white hover:bg-surface-2' : ''}
    {variant === 'ghost' ? 'text-dim hover:bg-hover hover:text-pure-white' : ''}
    {active ? 'text-pure-white' : ''} {cls}"
  type="button"
  {...rest}
>
  {@render children()}
</button>
