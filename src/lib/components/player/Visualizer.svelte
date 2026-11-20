<script lang="ts">  import { onMount } from 'svelte';
  import { engine } from '$lib/stores/player';
  import { settings } from '$lib/stores/settings';

  let { active = true }: { active?: boolean } = $props();

  let canvas: HTMLCanvasElement | undefined = $state();

  const MAX_CAP = 600;

  const px = new Float32Array(MAX_CAP);
  const py = new Float32Array(MAX_CAP);
  const vx = new Float32Array(MAX_CAP);
  const vy = new Float32Array(MAX_CAP);
  const life = new Float32Array(MAX_CAP);
  const maxLife = new Float32Array(MAX_CAP);
  const size = new Float32Array(MAX_CAP);
  const phase = new Float32Array(MAX_CAP);
  let count = 0;

  let width = 0;
  let height = 0;
  let dpr = 1;
  let cursor = 0;

  const spectrum = new Uint8Array(256);

  function spawn(x: number, y: number, bx: number, by: number, s: number, ttl: number, cap: number) {
    const idx = count < cap ? count++ : cursor++ % cap;
    px[idx] = x;
    py[idx] = y;
    vx[idx] = bx;
    vy[idx] = by;
    life[idx] = ttl;
    maxLife[idx] = ttl;
    size[idx] = s;
    phase[idx] = Math.random() * Math.PI * 2;
  }

  export function burstRect(rect: { left: number; top: number; width: number; height: number }): void {
    if (!canvas || !$settings.ui.visualizer) return;
    const cr = canvas.getBoundingClientRect();
    const cap = Math.min(MAX_CAP, Math.max(40, $settings.ui.particleCount));
    const n = Math.min(64, Math.max(16, Math.floor(rect.width / 8)));
    const ox = rect.left - cr.left;
    const oy = rect.top - cr.top;
    for (let i = 0; i < n; i++) {
      const x = ox + Math.random() * rect.width;
      const y = oy + Math.random() * rect.height;
      const driftX = (Math.random() - 0.5) * 38;
      const driftY = -18 - Math.random() * 48;
      spawn(
        x,
        y,
        driftX,
        driftY,
        1.6 + Math.random() * 2.4,
        1.0 + Math.random() * 1.3,
        cap
      );
    }
  }

  onMount(() => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const spriteSize = 24;
    const sprite: OffscreenCanvas | HTMLCanvasElement =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(spriteSize, spriteSize)
        : document.createElement('canvas');
    sprite.width = spriteSize;
    sprite.height = spriteSize;
    const sctx = sprite.getContext('2d');
    if (sctx) {
      const half = spriteSize / 2;
      const grad = sctx.createRadialGradient(half, half, 0.5, half, half, half);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.35, 'rgba(255,255,255,0.6)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      sctx.fillStyle = grad;
      sctx.fillRect(0, 0, spriteSize, spriteSize);
    }

    const resize = () => {
      if (!canvas) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let raf = 0;
    let last = performance.now();

    const frame = (now: number) => {
      if (document.hidden || !active || !$settings.ui.visualizer || width === 0 || height === 0) {
        raf = 0;
        count = 0;
        ctx.clearRect(0, 0, width, height);
        return;
      }
      raf = requestAnimationFrame(frame);

      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      let bass = 0;
      let mid = 0;
      if (engine.readSpectrum(spectrum)) {
        for (let i = 0; i < 10; i++) bass += spectrum[i];
        for (let i = 10; i < 48; i++) mid += spectrum[i];
        bass /= 10 * 255;
        mid /= 38 * 255;
      }

      ctx.clearRect(0, 0, width, height);
      if (count === 0) return;

      const boost = 1 + bass * 1.4;
      const tSec = now * 0.001;

      for (let i = 0; i < count; i++) {
        life[i] -= dt;
        if (life[i] <= 0) {
          const lastIdx = --count;
          if (i < lastIdx) {
            px[i] = px[lastIdx];
            py[i] = py[lastIdx];
            vx[i] = vx[lastIdx];
            vy[i] = vy[lastIdx];
            life[i] = life[lastIdx];
            maxLife[i] = maxLife[lastIdx];
            size[i] = size[lastIdx];
            phase[i] = phase[lastIdx];
          }
          i--;
          continue;
        }

        const sway = Math.sin(tSec * 2.4 + phase[i]) * (10 + mid * 20);
        px[i] += (vx[i] + sway) * dt * boost;
        py[i] += vy[i] * dt * boost;

        const norm = life[i] / maxLife[i];
        const fade = norm < 0.25 ? norm / 0.25 : norm > 0.85 ? (1 - norm) / 0.15 : 1;
        const flicker = 0.7 + 0.3 * Math.sin(tSec * 7.5 + phase[i]);
        const alpha = Math.min(1, fade * flicker * (0.55 + bass * 0.45));

        if (alpha <= 0.01) continue;
        const d = size[i] * 3.2 * (1 + bass * 0.35);
        ctx.globalAlpha = alpha;
        ctx.drawImage(sprite, px[i] - d / 2, py[i] - d / 2, d, d);
      }

      ctx.globalAlpha = 1;
    };

    const startLoop = () => {
      if (!raf && !document.hidden && active && $settings.ui.visualizer) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };

    const onVis = () => {
      if (!document.hidden) startLoop();
    };
    document.addEventListener('visibilitychange', onVis);

    $effect(() => {
      if (active && $settings.ui.visualizer) {
        startLoop();
      } else {
        if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
        count = 0;
        ctx.clearRect(0, 0, width, height);
      }
    });

    startLoop();

    return () => {
      document.removeEventListener('visibilitychange', onVis);
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
    };
  });
</script>

<canvas bind:this={canvas} class="pointer-events-none absolute inset-0 h-full w-full"></canvas>
