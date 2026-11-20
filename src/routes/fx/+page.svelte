<script lang="ts">  import { onMount } from 'svelte';
  import { isTauri } from '$lib/api/arima';

  interface FxPayload {
    kind: 'open' | 'close' | 'minimize';
    winRect: { x: number; y: number; w: number; h: number };
    monW?: number;
    monH?: number;
    targetX: number;
    targetY: number;
    edge: string;
    accent: string;
  }

  interface Particle {
    x: number;
    y: number;
    px: number;
    py: number;
    vx: number;
    vy: number;
    sx: number;
    sy: number;
    cx: number;
    cy: number;
    tx: number;
    ty: number;
    size: number;
    alpha: number;
    delay: number;
    phase: number;
    freq: number;
    isBurst?: boolean;
  }

  let canvas: HTMLCanvasElement | undefined = $state();

  function parseRgb(hex: string): [number, number, number] {
    const clean = (hex || '#ffffff').replace('#', '').trim();
    const full =
      clean.length === 3
        ? clean
            .split('')
            .map((c) => c + c)
            .join('')
        : clean.padEnd(6, '0').slice(0, 6);
    const num = parseInt(full, 16);
    if (Number.isNaN(num)) return [255, 255, 255];
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }

  function makeGlowSprite(r: number, g: number, b: number): HTMLCanvasElement {
    const size = 64;
    const off = document.createElement('canvas');
    off.width = size;
    off.height = size;
    const gctx = off.getContext('2d')!;
    const half = size / 2;
    const grad = gctx.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.22, `rgba(${r}, ${g}, ${b}, 0.92)`);
    grad.addColorStop(0.55, `rgba(${r}, ${g}, ${b}, 0.32)`);
    grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    gctx.fillStyle = grad;
    gctx.fillRect(0, 0, size, size);
    return off;
  }

  function quadBezier(p0: number, p1: number, p2: number, t: number): number {
    const inv = 1 - t;
    return inv * inv * p0 + 2 * inv * t * p1 + t * t * p2;
  }

  function sampleWindowPoint(rect: { x: number; y: number; w: number; h: number }, onBorder: boolean): [number, number] {
    if (!onBorder) {
      return [rect.x + Math.random() * rect.w, rect.y + Math.random() * rect.h];
    }
    const side = Math.floor(Math.random() * 4);
    if (side === 0) return [rect.x + Math.random() * rect.w, rect.y + (Math.random() - 0.5) * 14];
    if (side === 1) return [rect.x + rect.w + (Math.random() - 0.5) * 14, rect.y + Math.random() * rect.h];
    if (side === 2) return [rect.x + Math.random() * rect.w, rect.y + rect.h + (Math.random() - 0.5) * 14];
    return [rect.x + (Math.random() - 0.5) * 14, rect.y + Math.random() * rect.h];
  }

  onMount(() => {
    if (!canvas || !isTauri) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let unlisten: (() => void) | undefined;

    const runEffect = (p: FxPayload) => {
      cancelAnimationFrame(raf);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(window.innerWidth, p.monW ?? 0);
      const h = Math.max(window.innerHeight, p.monH ?? 0);
      canvas!.width = Math.round(w * dpr);
      canvas!.height = Math.round(h * dpr);
      canvas!.style.width = `${w}px`;
      canvas!.style.height = `${h}px`;

      const [r, g, b] = parseRgb(p.accent);
      const rgbStr = `${r}, ${g}, ${b}`;
      const sprite = makeGlowSprite(r, g, b);

      const particles: Particle[] = [];
      const cx = p.winRect.x + p.winRect.w * 0.5;
      const cy = p.winRect.y + p.winRect.h * 0.5;

      if (p.kind === 'open') {
        const count = 210;
        for (let i = 0; i < count; i++) {
          const edge = i % 4;
          const sx = edge === 0 ? Math.random() * w : edge === 1 ? w + 10 : edge === 2 ? Math.random() * w : -10;
          const sy = edge === 0 ? -10 : edge === 1 ? Math.random() * h : edge === 2 ? h + 10 : Math.random() * h;
          const ang = Math.atan2(cy - sy, cx - sx);
          const swirl = (i % 2 === 0 ? 1 : -1) * (90 + Math.random() * 140);
          const mx = (sx + cx) * 0.5 - Math.sin(ang) * swirl;
          const my = (sy + cy) * 0.5 + Math.cos(ang) * swirl;
          particles.push({
            x: sx,
            y: sy,
            px: sx,
            py: sy,
            vx: 0,
            vy: 0,
            sx,
            sy,
            cx: mx,
            cy: my,
            tx: cx + (Math.random() - 0.5) * 34,
            ty: cy + (Math.random() - 0.5) * 34,
            size: 3.5 + Math.random() * 4.5,
            alpha: 0.65 + Math.random() * 0.35,
            delay: Math.random() * 0.14,
            phase: Math.random() * Math.PI * 2,
            freq: 6 + Math.random() * 8
          });
        }

        for (let i = 0; i < 46; i++) {
          const ang = (i / 46) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
          const spd = 4.5 + Math.random() * 9.5;
          particles.push({
            x: cx,
            y: cy,
            px: cx,
            py: cy,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd,
            sx: cx,
            sy: cy,
            cx,
            cy,
            tx: cx,
            ty: cy,
            size: 2.5 + Math.random() * 3.5,
            alpha: 0.9,
            delay: 0,
            phase: Math.random() * Math.PI * 2,
            freq: 10,
            isBurst: true
          });
        }
      } else {

        const count = 280;
        for (let i = 0; i < count; i++) {
          const [sx, sy] = sampleWindowPoint(p.winRect, i < count * 0.42);
          const ang = Math.atan2(sy - cy, sx - cx) + (Math.random() - 0.5) * 0.95;
          const spd = 1.6 + Math.random() * 4.8;
          particles.push({
            x: sx,
            y: sy,
            px: sx,
            py: sy,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd - 0.9,
            sx,
            sy,
            cx: sx,
            cy: sy,
            tx: sx,
            ty: sy,
            size: 3.2 + Math.random() * 5.0,
            alpha: 0.72 + Math.random() * 0.28,
            delay: Math.random() * 0.12,
            phase: Math.random() * Math.PI * 2,
            freq: 4 + Math.random() * 7
          });
        }
      }

      const start = performance.now();
      const dur = p.kind === 'open' ? 760 : 840;

      const tick = (now: number) => {
        const elapsed = now - start;
        const t = Math.min(1, elapsed / dur);

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        if (p.kind === 'open') {
          const impactMs = 385;
          const shake =
            elapsed >= impactMs && elapsed < impactMs + 130
              ? Math.sin((elapsed - impactMs) * 0.28) * 5.5 * (1 - (elapsed - impactMs) / 130)
              : 0;
          if (shake !== 0) {
            ctx.translate(shake, shake * 0.45);
          }

          ctx.globalCompositeOperation = 'lighter';

          if (elapsed >= impactMs) {
            const wt = Math.min(1, (elapsed - impactMs) / 340);
            const easeOut = 1 - Math.pow(1 - wt, 3);
            ctx.beginPath();
            ctx.arc(cx, cy, 18 + easeOut * 310, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(${rgbStr}, ${(1 - wt) * 0.55})`;
            ctx.lineWidth = 3.2 * (1 - wt) + 0.5;
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(cx, cy, 10 + easeOut * 190, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255, 255, 255, ${(1 - wt) * 0.42})`;
            ctx.lineWidth = 1.6 * (1 - wt) + 0.4;
            ctx.stroke();
          }

          for (const pt of particles) {
            if (pt.isBurst) {
              if (elapsed < impactMs) continue;
              const bt = Math.min(1, (elapsed - impactMs) / 360);
              pt.px = pt.x;
              pt.py = pt.y;
              pt.x += pt.vx * (1 - bt * 0.65);
              pt.y += pt.vy * (1 - bt * 0.65);
              const a = pt.alpha * (1 - bt);
              if (a <= 0.01) continue;
              ctx.beginPath();
              ctx.moveTo(pt.px, pt.py);
              ctx.lineTo(pt.x, pt.y);
              ctx.strokeStyle = `rgba(${rgbStr}, ${a * 0.7})`;
              ctx.lineWidth = pt.size * 0.55;
              ctx.lineCap = 'round';
              ctx.stroke();
              ctx.globalAlpha = a;
              const d = pt.size * 3.4;
              ctx.drawImage(sprite, pt.x - d * 0.5, pt.y - d * 0.5, d, d);
              continue;
            }

            const lt = Math.max(0, Math.min(1, (elapsed / impactMs - pt.delay) / (1 - pt.delay)));
            const ease = lt * lt * lt;
            pt.px = pt.x;
            pt.py = pt.y;
            pt.x = quadBezier(pt.sx, pt.cx, pt.tx, ease);
            pt.y = quadBezier(pt.sy, pt.cy, pt.ty, ease);

            const fadeOut = elapsed > impactMs ? Math.max(0, 1 - (elapsed - impactMs) / 220) : 1;
            const a = pt.alpha * fadeOut * Math.min(1, lt * 3.2);
            if (a <= 0.01) continue;

            ctx.beginPath();
            ctx.moveTo(pt.px, pt.py);
            ctx.lineTo(pt.x, pt.y);
            ctx.strokeStyle = `rgba(${rgbStr}, ${a * 0.45})`;
            ctx.lineWidth = pt.size * 0.6;
            ctx.lineCap = 'round';
            ctx.stroke();

            ctx.globalAlpha = a;
            const d = pt.size * 3.6;
            ctx.drawImage(sprite, pt.x - d * 0.5, pt.y - d * 0.5, d, d);
          }
        } else {
          ctx.globalCompositeOperation = 'lighter';
          for (const pt of particles) {
            const lt = Math.max(0, (t - pt.delay) / Math.max(0.2, 1 - pt.delay));
            pt.px = pt.x;
            pt.py = pt.y;
            const curlX = Math.sin(elapsed * 0.008 + pt.phase) * 0.9;
            const curlY = Math.cos(elapsed * 0.007 + pt.phase) * 0.7 - 0.15;
            pt.x += pt.vx + curlX;
            pt.y += pt.vy + curlY;
            pt.vx *= 0.982;
            pt.vy *= 0.982;

            const flicker = 0.65 + 0.35 * Math.sin(elapsed * 0.014 * pt.freq + pt.phase);
            const a = pt.alpha * flicker * Math.max(0, 1 - Math.pow(lt, 1.5));
            if (a <= 0.01) continue;

            ctx.beginPath();
            ctx.moveTo(pt.px, pt.py);
            ctx.lineTo(pt.x, pt.y);
            ctx.strokeStyle = `rgba(${rgbStr}, ${a * 0.36})`;
            ctx.lineWidth = pt.size * 0.5;
            ctx.lineCap = 'round';
            ctx.stroke();

            ctx.globalAlpha = a;
            const d = pt.size * 3.8 * (1 - lt * 0.3);
            ctx.drawImage(sprite, pt.x - d * 0.5, pt.y - d * 0.5, d, d);
          }
        }

        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';

        if (t < 1) {
          raf = requestAnimationFrame(tick);
        } else {
          ctx.clearRect(0, 0, w, h);
        }
      };

      raf = requestAnimationFrame(tick);
    };

    (window as unknown as { __arimaFxPlay?: (p: FxPayload) => void }).__arimaFxPlay = runEffect;

    void (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen<FxPayload>('fx-play', (e) => runEffect(e.payload));
    })();

    return () => {
      delete (window as unknown as { __arimaFxPlay?: (p: FxPayload) => void }).__arimaFxPlay;
      cancelAnimationFrame(raf);
      unlisten?.();
    };
  });
</script>

<canvas bind:this={canvas} class="pointer-events-none fixed inset-0 h-screen w-screen bg-transparent"></canvas>
