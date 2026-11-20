<script lang="ts">  import { EQ_BANDS, EQ_PRESETS, type EqGains } from '$lib/audio/eq';
  import type { RemixMode } from '$lib/audio/engine';
  import Slider from '$lib/components/ui/Slider.svelte';
  import { lang } from '$lib/i18n';
  import { engine, remixState, setLocalRemix } from '$lib/stores/player';
  import { settings, updateSettings } from '$lib/stores/settings';

  const REMIX_MODES = $derived<{ id: RemixMode; label: string; meta: string }[]>([
    { id: 'original', label: $lang === 'ru' ? 'Оригинал' : 'Original', meta: '1.00×' },
    { id: 'slowed', label: 'Slowed', meta: '0.85×' },
    { id: 'slowed-reverb', label: 'Slowed + Reverb', meta: $lang === 'ru' ? '0.84× · Эхо' : '0.84× · Echo' },
    { id: 'speedup', label: 'Speed Up', meta: '1.18×' },
    { id: 'nightcore', label: 'Nightcore', meta: '1.22×' }
  ]);
  const BASS_PRESETS = [0, 25, 50, 75, 100];

  const eq = $derived($settings.audio.eq ?? [0, 0, 0, 0, 0]);
  const preamp = $derived($settings.audio.preamp ?? 0);
  const pPct = $derived(((preamp + 12) / 24) * 100);
  const activePreset = $derived($settings.audio.eqPreset ?? 'flat');

  let draggingBand = $state<number | 'preamp' | null>(null);
  let remixBarEl: HTMLElement | undefined = $state();
  let remixPill = $state({ x: 0, w: 0, show: false });

  $effect(() => {
    const m = $remixState.mode;
    queueMicrotask(() => {
      const el = remixBarEl?.querySelector<HTMLElement>(`[data-remix="${m}"]`);
      if (el) remixPill = { x: el.offsetLeft, w: el.offsetWidth, show: true };
    });
  });

  function applyPreset(id: string, gains: EqGains) {
    engine.setEq(gains, preamp);
    void updateSettings({ audio: { eqPreset: id, eq: [...gains] as EqGains } });
  }

  function setBand(index: number, db: number) {
    const clamped = Math.max(-12, Math.min(12, Math.round(db)));
    const next: EqGains = [...eq] as EqGains;
    next[index] = clamped;
    engine.setEq(next, preamp);
    void updateSettings({ audio: { eqPreset: 'custom', eq: next } });
  }

  function setPreamp(db: number) {
    const clamped = Math.max(-12, Math.min(12, Math.round(db)));
    engine.setEq(eq, clamped);
    void updateSettings({ audio: { preamp: clamped } });
  }

  function handleVerticalDrag(e: PointerEvent, target: number | 'preamp') {
    const el = e.currentTarget as HTMLElement;
    const calc = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const ratio = 1 - Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
      const db = ratio * 24 - 12;
      if (target === 'preamp') setPreamp(db);
      else setBand(target, db);
    };
    draggingBand = target;
    el.setPointerCapture(e.pointerId);
    calc(e);
  }

  const curvePath = $derived.by(() => {
    const pts = eq.map((db, i) => ({
      x: 10 + i * 20,
      y: 50 - (db / 12) * 36
    }));
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      d += ` C ${mx} ${pts[i].y}, ${mx} ${pts[i + 1].y}, ${pts[i + 1].x} ${pts[i + 1].y}`;
    }
    return d;
  });

  const areaPath = $derived(`${curvePath} L 90 95 L 10 95 Z`);
</script>

<div class="space-y-5">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div class="flex flex-wrap gap-1.5">
      {#each EQ_PRESETS as p (p.id)}
        <button
          class="rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-all duration-150 {activePreset === p.id
            ? 'bg-pure-white text-pure-black'
            : 'border border-line bg-surface text-dim hover:bg-surface-2 hover:text-pure-white'}"
          onclick={() => applyPreset(p.id, p.gains)}
        >
          {p.name}
        </button>
      {/each}
    </div>

    <button
      class="rounded-full border border-line px-3 py-1 text-[11px] text-dim transition-colors hover:text-pure-white"
      onclick={() => {
        applyPreset('flat', [0, 0, 0, 0, 0]);
        setPreamp(0);
      }}
    >
      {$lang === 'ru' ? 'Сброс' : 'Reset'}
    </button>
  </div>

  <div class="relative overflow-hidden rounded-2xl border border-line bg-surface p-5">
    <svg class="pointer-events-none absolute inset-x-5 top-5 h-44 w-[calc(100%-2.5rem)] opacity-35" viewBox="0 0 100 100" preserveAspectRatio="none">
      <line x1="0" y1="50" x2="100" y2="50" stroke="rgba(255,255,255,0.18)" stroke-dasharray="2 2" stroke-width="0.6" />
      <path d={areaPath} fill="rgba(255,255,255,0.08)" />
      <path d={curvePath} fill="none" stroke="#FFFFFF" stroke-width="1.4" />
    </svg>

    <div class="relative z-10 grid grid-cols-6 gap-2">
      {#each EQ_BANDS as band, i (band.freq)}
        {@const pct = ((eq[i] + 12) / 24) * 100}
        <div class="flex flex-col items-center">
          <div class="mb-2 text-[11px] font-medium text-pure-white">
            {eq[i] > 0 ? `+${eq[i]}` : eq[i]}
          </div>

          <div
            class="relative flex h-40 w-9 cursor-ns-resize items-center justify-center touch-none"
            role="slider"
            tabindex="0"
            aria-label={band.label}
            aria-valuemin="-12"
            aria-valuemax="12"
            aria-valuenow={eq[i]}
            onpointerdown={(e) => handleVerticalDrag(e, i)}
            onpointermove={(e) => {
              if (draggingBand === i) handleVerticalDrag(e, i);
            }}
            onpointerup={() => (draggingBand = null)}
            onkeydown={(e) => {
              if (e.key === 'ArrowUp') setBand(i, eq[i] + 1);
              else if (e.key === 'ArrowDown') setBand(i, eq[i] - 1);
            }}
          >
            <div class="relative h-full w-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                class="absolute bottom-0 left-0 w-full rounded-full bg-pure-white transition-[height] duration-75"
                style="height:{pct}%"
              ></div>
            </div>
            <div
              class="pointer-events-none absolute h-4 w-4 rounded-full border-2 border-pure-black bg-pure-white transition-[bottom] duration-75"
              style="bottom:calc({pct}% - 8px)"
            ></div>
          </div>

          <div class="mt-2 text-[11px] text-dim">{band.label}</div>
        </div>
      {/each}

      <div class="flex flex-col items-center border-l border-line pl-2">
        <div class="mb-2 text-[11px] font-medium text-pure-white">
          {preamp > 0 ? `+${preamp}` : preamp}
        </div>

        <div
          class="relative flex h-40 w-9 cursor-ns-resize items-center justify-center touch-none"
          role="slider"
          tabindex="0"
          aria-label={$lang === 'ru' ? 'Усиление' : 'Preamp'}
          aria-valuemin="-12"
          aria-valuemax="12"
          aria-valuenow={preamp}
          onpointerdown={(e) => handleVerticalDrag(e, 'preamp')}
          onpointermove={(e) => {
            if (draggingBand === 'preamp') handleVerticalDrag(e, 'preamp');
          }}
          onpointerup={() => (draggingBand = null)}
          onkeydown={(e) => {
            if (e.key === 'ArrowUp') setPreamp(preamp + 1);
            else if (e.key === 'ArrowDown') setPreamp(preamp - 1);
          }}
        >
          <div class="relative h-full w-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              class="absolute bottom-0 left-0 w-full rounded-full bg-pure-white/75 transition-[height] duration-75"
              style="height:{pPct}%"
            ></div>
          </div>
          <div
            class="pointer-events-none absolute h-4 w-4 rounded-full border-2 border-pure-black bg-pure-white transition-[bottom] duration-75"
            style="bottom:calc({pPct}% - 8px)"
          ></div>
        </div>

        <div class="mt-2 text-[11px] text-dim">Preamp</div>
      </div>
    </div>
  </div>

  <div class="rounded-2xl border border-line bg-surface p-5 space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <div class="text-[14px] font-semibold text-pure-white">
          {$lang === 'ru' ? 'Настройка воспроизведения' : 'Playback tuning'}
        </div>
        <div class="text-[12px] text-dim">
          {$lang === 'ru'
            ? 'Скорость, реверберация и усиление баса в реальном времени'
            : 'Real-time speed, reverb, and bass boost'}
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span class="rounded-full border border-line bg-pure-black/40 px-2.5 py-0.5 text-[11px] font-medium text-pure-white/85">
          {REMIX_MODES.find((m) => m.id === $remixState.mode)?.meta ?? '1.00×'}{$remixState.bassBoost > 0
            ? ` · Bass +${(($remixState.bassBoost / 100) * 15).toFixed(1)} ${$lang === 'ru' ? 'дБ' : 'dB'}`
            : ''}
        </span>
        {#if $remixState.mode !== 'original' || $remixState.bassBoost > 0}
          <button
            class="rounded-full border border-line px-3 py-1 text-[11px] font-medium text-dim transition-colors hover:border-pure-white/30 hover:text-pure-white"
            onclick={() => setLocalRemix('original', 0)}
          >
            {$lang === 'ru' ? 'Сбросить' : 'Reset'}
          </button>
        {/if}
      </div>
    </div>

    <div bind:this={remixBarEl} class="relative grid grid-cols-2 gap-1 rounded-xl border border-line bg-pure-black/40 p-1 sm:inline-flex sm:flex-wrap">
      {#if remixPill.show}
        <span
          class="pointer-events-none hidden sm:block absolute top-1 bottom-1 left-0 rounded-lg bg-pure-white transition-[transform,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style="transform: translate3d({remixPill.x}px, 0, 0); width: {remixPill.w}px"
          aria-hidden="true"
        ></span>
      {/if}
      {#each REMIX_MODES as m (m.id)}
        {@const active = $remixState.mode === m.id}
        <button
          data-remix={m.id}
          class="relative z-10 flex flex-col items-start sm:items-center rounded-lg px-3.5 py-2 text-left sm:text-center transition-colors duration-200 {active
            ? 'bg-pure-white sm:bg-transparent text-pure-black font-semibold'
            : 'text-dim hover:text-pure-white'}"
          onclick={() => setLocalRemix(m.id, $remixState.bassBoost)}
        >
          <span class="text-[12px] leading-tight">{m.label}</span>
          <span class="text-[10px] leading-tight {active ? 'text-pure-black/65' : 'text-faint'}">{m.meta}</span>
        </button>
      {/each}
    </div>

    <div class="rounded-xl border border-line bg-pure-black/35 p-3.5 space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <span class="text-[12px] font-medium text-pure-white">
            {$lang === 'ru' ? 'Bass Boost (85 Гц)' : 'Bass Boost (85 Hz)'}
          </span>
          <span class="rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-pure-white">
            +{(($remixState.bassBoost / 100) * 15).toFixed(1)} {$lang === 'ru' ? 'дБ' : 'dB'} ({$remixState.bassBoost}%)
          </span>
        </div>
        <div class="flex items-center gap-1">
          {#each BASS_PRESETS as pct (pct)}
            <button
              class="rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors {$remixState.bassBoost === pct
                ? 'bg-pure-white text-pure-black'
                : 'bg-surface/70 text-dim hover:text-pure-white'}"
              onclick={() => setLocalRemix($remixState.mode, pct)}
            >
              {pct}%
            </button>
          {/each}
        </div>
      </div>
      <Slider
        value={$remixState.bassBoost}
        max={100}
        height={5}
        label="Bass Boost"
        onchange={(v) => setLocalRemix($remixState.mode, v)}
      />
    </div>
  </div>
</div>
