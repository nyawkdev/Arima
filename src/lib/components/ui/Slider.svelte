<script lang="ts">  let {
    value,
    max,
    onchange,
    height = 3,
    label = ''
  }: { value: number; max: number; onchange: (v: number) => void; height?: number; label?: string } = $props();

  let el: HTMLDivElement;
  let dragging = $state(false);
  let dragValue = $state(0);

  const shown = $derived(dragging ? dragValue : value);
  const pct = $derived(max > 0 ? Math.min(100, Math.max(0, (shown / max) * 100)) : 0);

  function calc(e: PointerEvent): number {
    const r = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * max;
  }

  function down(e: PointerEvent) {
    if (max <= 0) return;
    dragging = true;
    dragValue = calc(e);
    el.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    if (dragging) dragValue = calc(e);
  }
  function up(e: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    onchange(calc(e));
  }
  function key(e: KeyboardEvent) {
    const step = max / 50;
    if (e.key === 'ArrowRight') onchange(Math.min(max, value + step));
    else if (e.key === 'ArrowLeft') onchange(Math.max(0, value - step));
  }
</script>

<div
  bind:this={el}
  class="group relative flex w-full cursor-pointer items-center"
  style="height:{height + 12}px"
  role="slider"
  tabindex="0"
  aria-label={label}
  aria-valuemin="0"
  aria-valuemax={max}
  aria-valuenow={shown}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onkeydown={key}
>
  <div class="relative w-full overflow-hidden rounded-full bg-surface-2" style="height:{height}px">
    <div class="absolute left-0 top-0 h-full rounded-full" style="width:{pct}%; background: var(--accent-bg)"></div>
  </div>
  <div
    class="pointer-events-none absolute h-3 w-3 -translate-x-1/2 rounded-full opacity-0 transition-opacity group-hover:opacity-100"
    style="left:{pct}%; background: var(--accent); box-shadow: 0 0 10px var(--accent-glow)"
  ></div>
</div>
