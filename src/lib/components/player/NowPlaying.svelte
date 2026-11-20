<script lang="ts">  import { onMount } from 'svelte';
  import { cubicOut } from 'svelte/easing';
  import { crossfade, fade, fly } from 'svelte/transition';
  import { liquidMagnetic } from '$lib/actions/liquidMagnetic';
  import { userMessage } from '$lib/api/arima';
  import EqPanel from '$lib/components/player/EqPanel.svelte';
  import Visualizer from '$lib/components/player/Visualizer.svelte';
  import Cover from '$lib/components/ui/Cover.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import Loader from '$lib/components/ui/Loader.svelte';
  import Slider from '$lib/components/ui/Slider.svelte';
  import { lang } from '$lib/i18n';
  import { likedIds, toggleLike } from '$lib/stores/library';
  import {
    ensureLyrics,
    lyricSegments,
    lyrics
  } from '$lib/stores/lyrics';
  import { duration, engine, player, playerActions, position } from '$lib/stores/player';
  import { settings } from '$lib/stores/settings';
  import { expandedOpen, say } from '$lib/stores/ui';
  import { formatCount, formatTime, trackArtwork } from '$lib/utils';

  let { tab = $bindable<'overview' | 'lyrics' | 'queue' | 'eq'>('overview') }: {
    tab?: 'overview' | 'lyrics' | 'queue' | 'eq';
  } = $props();

  let vis: ReturnType<typeof Visualizer> | undefined = $state();
  let specCanvas: HTMLCanvasElement | undefined = $state();
  let lineEls: HTMLButtonElement[] = [];
  let lyricScrollEl: HTMLDivElement | undefined = $state();
  let autoFollow = false;
  let userScrollUntil = 0;

  function markUserScroll() {

    userScrollUntil = performance.now() + 4200;
    autoFollow = false;
  }

  const fxScale: number[] = [];
  const fxOpacity: number[] = [];
  let lastFxTs = 0;

  function updateLyricsFx() {
    const box = lyricScrollEl;
    if (!box || tab !== 'lyrics') return;
    const now = performance.now();
    const dt = Math.min(64, Math.max(4, now - (lastFxTs || now - 16)));
    lastFxTs = now;
    const boxH = box.clientHeight;
    if (boxH <= 0) return;
    const half = boxH / 2;

    const idx = prevLine;
    let autoTarget = -1;
    if (idx >= 0 && lineEls[idx] && now > userScrollUntil) {
      const el = lineEls[idx];
      autoTarget = el.offsetTop + el.offsetHeight / 2 - half;
    }
    const scrollTop = box.scrollTop;
    const centers: number[] = new Array(lineEls.length);
    for (let i = 0; i < lineEls.length; i++) {
      const el = lineEls[i];
      centers[i] = el ? el.offsetTop + el.offsetHeight / 2 - scrollTop : Infinity;
    }

    const follow = 1 - Math.exp(-dt / (autoFollow ? 170 : 260));
    if (autoTarget >= 0) {
      const diff = autoTarget - scrollTop;
      if (Math.abs(diff) > 0.4) box.scrollTop = scrollTop + diff * follow;
      else autoFollow = false;
    }

    const ease = 1 - Math.exp(-dt / 140);
    for (let i = 0; i < lineEls.length; i++) {
      const el = lineEls[i];
      if (!el || !Number.isFinite(centers[i])) continue;
      const d = Math.min(1, Math.abs(centers[i] - half) / half);
      const smooth = d * d * (3 - 2 * d);
      const isCur = i === prevLine;
      const tScale = (0.46 + (1 - smooth) * 0.54) * (isCur ? 1.03 : 1);
      const tFade = 0.25 + (1 - smooth) * 0.75;
      const cs = fxScale[i] ?? tScale;
      const co = fxOpacity[i] ?? tFade;
      const ns = cs + (tScale - cs) * ease;
      const no = co + (tFade - co) * ease;
      fxScale[i] = ns;
      fxOpacity[i] = no;
      el.style.transform = `scale(${ns.toFixed(3)}) translateZ(0)`;
      el.style.opacity = no.toFixed(3);
    }
  }
  let wordEls: Record<string, HTMLSpanElement> = {};
  let dissolvedWords = new Set<string>();
  let prevTrackId = -1;
  let prevLine = -1;

  let livePos = $state(0);
  let bassEnergy = $state(0);
  const LYRIC_LEAD_MS = 45;

  const track = $derived($player.current);
  const playing = $derived($player.status === 'playing');
  const liked = $derived(track ? $likedIds.has(track.id) : false);
  const totalSec = $derived($duration || (track ? track.duration / 1000 : 0));
  const fontSize = $derived($settings.ui.lyricsSize || 34);

  const activeIdx = $derived.by(() => {
    const d = $lyrics.data;
    if (!d || !d.synced) return -1;
    const ms = livePos * 1000 + LYRIC_LEAD_MS;
    const segs = $lyricSegments;
    let lo = 0;
    let hi = d.lines.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const startMs = segs[mid]?.startMs ?? d.lines[mid].t;
      if (startMs <= ms) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  });

  $effect(() => {
    if ($expandedOpen && tab === 'lyrics') void ensureLyrics();
  });

  $effect(() => {
    const id = track?.id ?? -1;
    if (id !== prevTrackId) {
      prevTrackId = id;
      prevLine = -1;
      dissolvedWords.clear();
      livePos = 0;
    }
  });

  $effect(() => {
    if (!playing) livePos = $position;
  });

  $effect(() => {
    if (!$expandedOpen) return;
    const isPlaying = playing;
    const isLyricsTab = tab === 'lyrics';
    let raf = 0;
    const specBuf = new Uint8Array(256);
    const visBars = new Float32Array(64);
    let settledFrames = 0;

    const loop = () => {
      if (document.hidden) {
        raf = 0;
        return;
      }
      if (isPlaying) livePos = engine.currentTime;
      const hasAudio = isPlaying && engine.readSpectrum(specBuf);
      if (hasAudio) {
        settledFrames = 0;
        const b = (specBuf[1] + specBuf[2] + specBuf[3] + specBuf[4]) / (4 * 255);
        bassEnergy = bassEnergy * 0.7 + b * 0.3;
      } else {
        bassEnergy = bassEnergy * 0.88;
        if (!isPlaying && bassEnergy < 0.004) settledFrames++;
      }
      if (specCanvas && (!isPlaying ? settledFrames < 45 : true)) {
        const ctx = specCanvas.getContext('2d');
        if (ctx) {
          const w = specCanvas.width;
          const h = specCanvas.height;
          ctx.clearRect(0, 0, w, h);
          const bars = 64;
          const gap = 4;
          const bw = (w - gap * (bars - 1)) / bars;
          for (let i = 0; i < bars; i++) {

            const t = i / (bars - 1);
            const binStart = Math.floor(2 + Math.pow(t, 1.55) * 72);
            const binEnd = Math.max(binStart + 1, Math.floor(2 + Math.pow((i + 1) / bars, 1.55) * 76));
            let peak = 0;
            if (hasAudio) {
              for (let b = binStart; b < Math.min(90, binEnd); b++) {
                if (specBuf[b] > peak) peak = specBuf[b];
              }
            }
            const target = hasAudio ? Math.min(1, (peak / 255) * (0.9 + t * 0.35)) : 0.03;
            visBars[i] = visBars[i] * 0.65 + target * 0.35;
            const v = visBars[i];
            const bh = Math.max(4, v * h * 0.85);
            const grad = ctx.createLinearGradient(0, h - bh, 0, h);
            grad.addColorStop(0, `rgba(255,255,255,${0.28 + v * 0.45})`);
            grad.addColorStop(1, 'rgba(255,255,255,0.02)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.roundRect(i * (bw + gap), h - bh, bw, bh, 3);
            ctx.fill();
          }
        }
      }
      if (isLyricsTab) updateLyricsFx();

      if (!isPlaying && !isLyricsTab && settledFrames >= 45) {
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(loop);
    };

    const onVis = () => {
      if (!document.hidden && !raf) {
        settledFrames = 0;
        raf = requestAnimationFrame(loop);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    if (!document.hidden) raf = requestAnimationFrame(loop);

    return () => {
      document.removeEventListener('visibilitychange', onVis);
      if (raf) cancelAnimationFrame(raf);
    };
  });

  function lineProgressAt(lineIdx: number, wordCount: number): number {
    const d = $lyrics.data;
    if (!d) return 0;
    const seg = $lyricSegments[lineIdx];
    const startMs = seg?.startMs ?? d.lines[lineIdx].t;
    const nextMs = seg?.nextStartMs ?? d.lines[lineIdx + 1]?.t ?? (totalSec * 1000 || startMs + 4000);
    const singDur = seg?.singDurationMs ?? Math.min(Math.max(450, nextMs - startMs), Math.max(1400, wordCount * 380));
    return Math.min(1, Math.max(0, (livePos * 1000 + LYRIC_LEAD_MS - startMs) / Math.max(300, singDur)));
  }

  $effect(() => {
    if (!$expandedOpen || tab !== 'lyrics') return;
    const d = $lyrics.data;
    const idx = activeIdx;
    if (!d || !d.synced || idx < 0) return;

    if (idx !== prevLine) {
      if (prevLine >= 0 && lineEls[prevLine]) {
        const lineWords = d.lines[prevLine].text.split(/\s+/);
        for (let w = 0; w < lineWords.length; w++) {
          const key = `${prevLine}:${w}`;
          if (!dissolvedWords.has(key) && wordEls[key] && vis) {
            dissolvedWords.add(key);
            vis.burstRect(wordEls[key].getBoundingClientRect());
          }
        }
      }
      prevLine = idx;
      autoFollow = true;
    }

    const curLine = d.lines[idx];
    const words = curLine.text.split(/\s+/);
    const prog = lineProgressAt(idx, words.length);
    const cumWeights = $lyricSegments[idx]?.wordCumulativeWeights;

    for (let w = 0; w < words.length; w++) {
      const threshold = cumWeights?.[w] ?? (w + 1) / words.length;
      if (prog >= threshold) {
        const key = `${idx}:${w}`;
        if (!dissolvedWords.has(key) && wordEls[key] && vis) {
          dissolvedWords.add(key);
          vis.burstRect(wordEls[key].getBoundingClientRect());
        }
      }
    }
  });

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && $expandedOpen) expandedOpen.set(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function like() {
    if (!track) return;
    try {
      await toggleLike(track);
    } catch (e) {
      say(userMessage(e));
    }
  }

  function activeWordIdx(lineIdx: number, totalWords: number): number {
    const d = $lyrics.data;
    if (!d?.synced || lineIdx !== activeIdx) return -1;
    const prog = lineProgressAt(lineIdx, totalWords);
    const weights = $lyricSegments[lineIdx]?.wordCumulativeWeights;
    for (let w = 0; w < totalWords; w++) {
      const threshold = weights?.[w] ?? (w + 1) / totalWords;
      if (prog < threshold) return w;
    }
    return totalWords;
  }

  const isInInstrumentalGap = $derived.by(() => {
    const d = $lyrics.data;
    if (!d?.synced || !playing) return false;
    const ms = livePos * 1000 + LYRIC_LEAD_MS;
    if (activeIdx < 0) {
      const firstStart = $lyricSegments[0]?.startMs ?? 0;
      return firstStart >= 3500 && firstStart - ms >= 2200;
    }
    const seg = $lyricSegments[activeIdx];
    if (!seg) return false;
    const gap = seg.nextStartMs - (seg.startMs + seg.singDurationMs);
    if (gap < 3500) return false;
    return ms > seg.startMs + seg.singDurationMs + 650 && ms < seg.nextStartMs - 550;
  });

  function isWordPassed(lineIdx: number, wordIdx: number, totalWords: number): boolean {
    const d = $lyrics.data;
    if (!d?.synced) return false;
    if (lineIdx < activeIdx) return true;
    if (lineIdx > activeIdx) return false;
    const prog = lineProgressAt(lineIdx, totalWords);
    const threshold = $lyricSegments[lineIdx]?.wordCumulativeWeights?.[wordIdx] ?? (wordIdx + 1) / totalWords;
    return prog >= threshold;
  }

  const [send, receive] = crossfade({
    duration: 420,
    easing: cubicOut,
    fallback(node) {
      return fly(node, { y: 10, duration: 220, easing: cubicOut });
    }
  });

  function toggleSub(target: 'lyrics' | 'queue' | 'eq') {
    tab = tab === target ? 'overview' : target;
  }

  let modeBarEl: HTMLElement | undefined = $state();
  let topModeBarEl: HTMLElement | undefined = $state();
  let modePill = $state({ x: 0, w: 0, show: false });
  let topModePill = $state({ x: 0, w: 0, show: false });

  $effect(() => {
    void tab;
    queueMicrotask(() => {
      const active = modeBarEl?.querySelector<HTMLElement>(`[data-tab="${tab}"]`);
      if (active) modePill = { x: active.offsetLeft, w: active.offsetWidth, show: true };
      else modePill = { ...modePill, show: false };

      const topActive = topModeBarEl?.querySelector<HTMLElement>(`[data-tab="${tab}"]`);
      if (topActive) topModePill = { x: topActive.offsetLeft, w: topActive.offsetWidth, show: true };
      else topModePill = { ...topModePill, show: false };
    });
  });
</script>

{#snippet modeButtons()}
  <div
    bind:this={modeBarEl}
    class="relative mt-5 inline-flex items-center justify-center gap-1 rounded-full bg-pure-white/[0.06] p-1"
    style="box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08)"
  >
    {#if modePill.show}
      <span
        class="pointer-events-none absolute top-1 bottom-1 left-0 rounded-full bg-pure-white transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
        style="transform: translate3d({modePill.x}px, 0, 0); width: {modePill.w}px"
        aria-hidden="true"
      ></span>
    {/if}
    <button
      data-tab="lyrics"
      class="relative z-10 flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[12px] font-medium transition-colors duration-200 {tab === 'lyrics'
        ? 'text-pure-black font-semibold'
        : 'text-dim hover:text-pure-white'}"
      onclick={() => toggleSub('lyrics')}
    >
      <Icon name="lyrics" size={13} />
      <span>{$lang === 'ru' ? 'Текст' : 'Lyrics'}</span>
    </button>
    <button
      data-tab="queue"
      class="relative z-10 flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[12px] font-medium transition-colors duration-200 {tab === 'queue'
        ? 'text-pure-black font-semibold'
        : 'text-dim hover:text-pure-white'}"
      onclick={() => toggleSub('queue')}
    >
      <Icon name="queue" size={13} />
      <span>{$lang === 'ru' ? 'Очередь' : 'Queue'}</span>
    </button>
    <button
      data-tab="eq"
      class="relative z-10 flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[12px] font-medium transition-colors duration-200 {tab === 'eq'
        ? 'text-pure-black font-semibold'
        : 'text-dim hover:text-pure-white'}"
      onclick={() => toggleSub('eq')}
    >
      <Icon name="sliders" size={13} />
      <span>{$lang === 'ru' ? 'Звук' : 'Audio'}</span>
    </button>
  </div>
{/snippet}

{#if $expandedOpen}
  <div
    class="fixed inset-0 top-16 z-40 flex flex-col overflow-hidden bg-pure-black"
    transition:fly={{ y: 36, duration: 240 }}
  >
    {#if track}
      <img
        src={trackArtwork(track, 't500x500')}
        alt=""
        class="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-30 blur-[100px] transition-opacity duration-700"
        transition:fade={{ duration: 300 }}
        draggable="false"
      />
    {/if}
    <div class="pointer-events-none absolute inset-0 bg-pure-black/55"></div>
    <canvas
      bind:this={specCanvas}
      width="960"
      height="220"
      class="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-[30vh] w-full opacity-20"
      aria-hidden="true"
    ></canvas>

    <div class="relative z-10 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 px-8 pt-4 pb-2">
      {#if tab === 'lyrics' && track}
        <div class="flex min-w-0 items-center gap-3">
          <div
            in:receive={{ key: 'np-cover' }}
            out:send={{ key: 'np-cover' }}
            class="shrink-0 overflow-hidden rounded-xl transition-transform duration-150"
            style="transform: scale({1 + bassEnergy * 0.03}); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.14)"
          >
            <Cover src={trackArtwork(track, 't120x120')} size={40} radius={10} />
          </div>
          <div class="min-w-0" in:receive={{ key: 'np-meta' }} out:send={{ key: 'np-meta' }}>
            <div class="truncate text-[13.5px] font-semibold text-pure-white">{track.title}</div>
            <div class="truncate text-[12px] text-dim">{track.user?.username}</div>
          </div>
        </div>

        <div
          bind:this={topModeBarEl}
          class="relative inline-flex items-center gap-1 rounded-full bg-pure-white/[0.06] p-1"
          style="box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08)"
        >
          {#if topModePill.show}
            <span
              class="pointer-events-none absolute top-1 bottom-1 left-0 rounded-full bg-pure-white transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
              style="transform: translate3d({topModePill.x}px, 0, 0); width: {topModePill.w}px"
              aria-hidden="true"
            ></span>
          {/if}
          <button
            data-tab="lyrics"
            class="relative z-10 rounded-full px-3.5 py-1 text-[12px] font-semibold text-pure-black transition-colors duration-200"
            onclick={() => toggleSub('lyrics')}
          >
            {$lang === 'ru' ? 'Текст' : 'Lyrics'}
          </button>
          <button
            data-tab="queue"
            class="relative z-10 rounded-full px-3.5 py-1 text-[12px] font-medium text-dim transition-colors duration-200 hover:text-pure-white"
            onclick={() => toggleSub('queue')}
          >
            {$lang === 'ru' ? 'Очередь' : 'Queue'}
          </button>
          <button
            data-tab="eq"
            class="relative z-10 rounded-full px-3.5 py-1 text-[12px] font-medium text-dim transition-colors duration-200 hover:text-pure-white"
            onclick={() => toggleSub('eq')}
          >
            {$lang === 'ru' ? 'Звук' : 'Audio'}
          </button>
        </div>

        <div class="flex items-center justify-end gap-2">
          <div class="relative flex p-1.5 -m-1.5">
            <button
              use:liquidMagnetic={{ maxPull: 6, stretch: 0.12, snapDistance: 36 }}
              class="flex h-9 w-9 items-center justify-center rounded-full bg-pure-white/[0.08] text-pure-white hover:bg-pure-white/[0.15]"
              onclick={() => playerActions.toggle()}
              aria-label={playing ? ($lang === 'ru' ? 'Пауза' : 'Pause') : ($lang === 'ru' ? 'Играть' : 'Play')}
            >
              <Icon name={playing ? 'pause' : 'play'} size={14} />
            </button>
          </div>
          <div class="relative flex p-1.5 -m-1.5">
            <button
              use:liquidMagnetic={{ maxPull: 6, stretch: 0.12, snapDistance: 36 }}
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pure-black/60 text-dim backdrop-blur-xl hover:text-pure-white"
              style="box-shadow: inset 0 0 0 1px rgba(255,255,255,0.14)"
              onclick={() => expandedOpen.set(false)}
              aria-label={$lang === 'ru' ? 'Свернуть плеер' : 'Collapse player'}
            >
              <Icon name="chevron-down" size={17} />
            </button>
          </div>
        </div>
      {:else}
        <div></div>
        <div></div>
        <div class="flex justify-end">
          <button
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pure-black/60 text-dim backdrop-blur-xl transition-all duration-150 hover:text-pure-white active:scale-95"
            style="box-shadow: inset 0 0 0 1px rgba(255,255,255,0.14)"
            onclick={() => expandedOpen.set(false)}
            aria-label={$lang === 'ru' ? 'Свернуть плеер' : 'Collapse player'}
          >
            <Icon name="chevron-down" size={17} />
          </button>
        </div>
      {/if}
    </div>

    <div class="relative z-10 grid min-h-0 flex-1 grid-cols-1 gap-8 px-10 pb-6 {tab === 'overview' || tab === 'lyrics' ? '' : 'lg:grid-cols-[380px_minmax(0,1fr)]'}">
      {#if tab === 'overview'}
        <div class="flex flex-col items-center justify-center text-center">
          {#if track}
            <div class="relative" in:receive={{ key: 'np-cover' }} out:send={{ key: 'np-cover' }}>
              <img
                src={trackArtwork(track, 't500x500')}
                alt=""
                class="pointer-events-none absolute -inset-6 h-[368px] w-[368px] rounded-3xl object-cover opacity-45 blur-3xl"
                draggable="false"
              />
              <div class="relative overflow-hidden rounded-3xl" style="box-shadow: inset 0 0 0 1px rgba(255,255,255,0.2)">
                <Cover src={trackArtwork(track, 't500x500')} size={310} radius={24} />
              </div>
            </div>

            <div class="mt-6 w-full max-w-lg" in:receive={{ key: 'np-meta' }} out:send={{ key: 'np-meta' }}>
              <div class="truncate text-[24px] font-bold tracking-tight text-pure-white">{track.title}</div>
              {#if track.user?.id}
                <a
                  href="/artist/{track.user.id}"
                  class="mt-1 inline-block text-[15px] text-dim transition-colors hover:text-pure-white hover:underline"
                  onclick={() => expandedOpen.set(false)}
                >
                  {track.user.username}
                </a>
              {/if}

              <div class="mt-2.5 flex items-center justify-center gap-4 text-[12px] text-dim">
                {#if track.genre}<span>{track.genre}</span>{/if}
                {#if track.playback_count}<span>{formatCount(track.playback_count)} {$lang === 'ru' ? 'прослушиваний' : 'plays'}</span>{/if}
                {#if track.likes_count}<span>{formatCount(track.likes_count)} {$lang === 'ru' ? 'лайков' : 'likes'}</span>{/if}
              </div>

              <div class="mt-5">
                <Slider value={livePos} max={totalSec} height={4} label={$lang === 'ru' ? 'Позиция' : 'Seek'} onchange={(v) => playerActions.seek(v)} />
                <div class="mt-1 flex justify-between text-[11px] text-dim">
                  <span>{formatTime(livePos)}</span>
                  <span>{formatTime(totalSec)}</span>
                </div>
              </div>

              <div class="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
                <div class="flex items-center justify-end gap-4">
                  <button
                    class="flex h-9 w-9 items-center justify-center rounded-full transition-colors {liked
                      ? 'text-pure-white'
                      : 'text-dim hover:text-pure-white'}"
                    onclick={like}
                    aria-label={$lang === 'ru' ? 'Лайк' : 'Like'}
                  >
                    <Icon name={liked ? 'heart-fill' : 'heart'} size={17} />
                  </button>
                  <button
                    class="flex h-9 w-9 items-center justify-center rounded-full transition-colors {$player.shuffle
                      ? 'text-pure-white'
                      : 'text-dim hover:text-pure-white'}"
                    onclick={() => playerActions.toggleShuffle()}
                    aria-label={$lang === 'ru' ? 'Перемешать' : 'Shuffle'}
                  >
                    <Icon name="shuffle" size={17} />
                  </button>
                  <button
                    class="flex h-11 w-11 items-center justify-center rounded-full text-dim transition-colors hover:text-pure-white"
                    onclick={() => playerActions.prev()}
                    aria-label={$lang === 'ru' ? 'Предыдущий' : 'Previous'}
                  >
                    <Icon name="prev" size={22} />
                  </button>
                </div>

                <div class="relative flex p-2 -m-2">
                  <button
                    use:liquidMagnetic={{ maxPull: 10, stretch: 0.16, snapDistance: 48 }}
                    class="accent-surface flex h-14 w-14 items-center justify-center rounded-full will-change-transform"
                    onclick={() => playerActions.toggle()}
                    aria-label={playing ? ($lang === 'ru' ? 'Пауза' : 'Pause') : ($lang === 'ru' ? 'Играть' : 'Play')}
                  >
                    <Icon name={playing ? 'pause' : 'play'} size={22} />
                  </button>
                </div>

                <div class="flex items-center justify-start gap-4">
                  <button
                    class="flex h-11 w-11 items-center justify-center rounded-full text-dim transition-colors hover:text-pure-white"
                    onclick={() => playerActions.next()}
                    aria-label={$lang === 'ru' ? 'Следующий' : 'Next'}
                  >
                    <Icon name="next" size={22} />
                  </button>
                  <button
                    class="flex h-9 w-9 items-center justify-center rounded-full transition-colors {$player.repeat !== 'off'
                      ? 'text-pure-white'
                      : 'text-dim hover:text-pure-white'}"
                    onclick={() => playerActions.cycleRepeat()}
                    aria-label={$lang === 'ru' ? 'Повтор' : 'Repeat'}
                  >
                    <Icon name={$player.repeat === 'one' ? 'repeat-one' : 'repeat'} size={17} />
                  </button>
                  <span class="h-9 w-9" aria-hidden="true"></span>
                </div>
              </div>

              {@render modeButtons()}
            </div>
          {:else}
            <div class="text-[14px] text-dim">{$lang === 'ru' ? 'Ничего не играет' : 'Nothing playing'}</div>
          {/if}
        </div>
      {:else if tab === 'lyrics'}
        <div class="relative mx-auto flex min-h-0 w-full max-w-4xl flex-col" in:fade={{ duration: 180 }}>
          {#if $lyrics.status === 'loading'}
            <div class="flex flex-1 items-center justify-center"><Loader /></div>
          {:else if $lyrics.data && $lyrics.data.lines.length > 0}
            {#if isInInstrumentalGap}
              <div
                class="pointer-events-none absolute top-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-edge/60 bg-surface/85 px-3.5 py-1.5 backdrop-blur-md"
                transition:fade={{ duration: 220 }}
              >
                {#each [0, 1, 2] as dot (dot)}
                  <span
                    class="h-2 w-2 rounded-full transition-transform duration-150"
                    style="background: var(--accent); opacity: {0.4 + bassEnergy * 0.6}; transform: scale({0.85 + bassEnergy * (0.35 + dot * 0.08)})"
                  ></span>
                {/each}
                <span class="ml-0.5 text-[11px] font-medium text-dim">{$lang === 'ru' ? 'Проигрыш…' : 'Instrumental…'}</span>
              </div>
            {/if}
            <div
              bind:this={lyricScrollEl}
              role="region"
              aria-label={$lang === 'ru' ? 'Текст песни' : 'Lyrics'}
              class="scroll-y no-scrollbar min-h-0 flex-1 px-4"
              onwheel={markUserScroll}
              ontouchstart={markUserScroll}
              ontouchmove={markUserScroll}
              style="-webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 14%, black 86%, transparent 100%); mask-image: linear-gradient(to bottom, transparent 0%, black 14%, black 86%, transparent 100%);"
            >
              <div class="flex flex-col items-center gap-5 py-[34vh]">
                {#each $lyrics.data.lines as line, i (i)}
                  {@const isCurrent = $lyrics.data.synced && i === activeIdx}
                  {@const isPast = $lyrics.data.synced && i < activeIdx}
                  {@const words = line.text.split(/\s+/)}
                  {@const curWord = isCurrent ? activeWordIdx(i, words.length) : -1}
                  <button
                    bind:this={lineEls[i]}
                    class="relative block w-full origin-center text-center font-bold leading-[1.12] will-change-transform transition-colors duration-500 ease-out {isCurrent
                      ? 'text-pure-white'
                      : isPast
                        ? 'text-pure-white/30'
                        : 'text-pure-white/60 hover:text-pure-white/90'}"
                    style="font-size:{Math.max(52, fontSize * 2)}px"
                    onclick={() => {
                      const targetMs = $lyricSegments[i]?.startMs ?? line.t;
                      if (targetMs >= 0) playerActions.seek(targetMs / 1000);
                    }}
                    disabled={line.t < 0}
                  >
                    {#each words as word, wi (`${i}:${wi}`)}
                      {@const passed = isWordPassed(i, wi, words.length)}
                      {@const isSingWord = isCurrent && wi === curWord}
                      <span
                        bind:this={wordEls[`${i}:${wi}`]}
                        style="text-shadow: {isSingWord ? '0 0 22px var(--accent-glow)' : '0 0 0px transparent'}"
                        class="inline-block will-change-transform transition-[opacity,transform,color,text-shadow] duration-[540ms] ease-[cubic-bezier(0.22,1,0.36,1)] {passed
                          ? 'opacity-25 scale-100'
                          : isSingWord
                            ? 'scale-[1.05] opacity-100 text-pure-white'
                            : isCurrent
                              ? 'opacity-80 scale-100'
                              : 'scale-100'}"
                      >{word}</span>{' '}
                    {/each}
                  </button>
                {/each}
              </div>

              <div class="pb-10 flex flex-wrap items-center gap-3 text-[11px] text-faint">
                <span>{$lang === 'ru' ? 'Источник:' : 'Source:'} {$lyrics.data.source}</span>
                {#if $lyrics.data.adapted}
                  <span class="rounded-full bg-surface px-2.5 py-0.5 text-pure-white/80">{$lyrics.data.adapted}</span>
                {/if}
              </div>
            </div>

            <div class="pt-3">
              <Slider value={livePos} max={totalSec} height={3} label={$lang === 'ru' ? 'Позиция' : 'Seek'} onchange={(v) => playerActions.seek(v)} />
              <div class="mt-1 flex justify-between text-[11px] text-dim">
                <span>{formatTime(livePos)}</span>
                <span>{formatTime(totalSec)}</span>
              </div>
            </div>
          {:else}
            <div class="flex flex-1 items-center justify-center text-[14px] text-dim">
              {$lang === 'ru' ? 'Текст для этого трека не найден' : 'No lyrics found for this track'}
            </div>
          {/if}
        </div>
      {:else}
        <div class="flex flex-col items-center justify-center">
          {#if track}
            <div class="relative" in:receive={{ key: 'np-cover' }} out:send={{ key: 'np-cover' }}>
              <img
                src={trackArtwork(track, 't500x500')}
                alt=""
                class="pointer-events-none absolute -inset-4 h-[332px] w-[332px] rounded-3xl object-cover opacity-40 blur-3xl"
                draggable="false"
              />
              <div
                class="relative overflow-hidden rounded-[20px] transition-transform duration-100"
                style="transform: scale({1 + bassEnergy * 0.032}); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.2), 0 0 {Math.round(18 + bassEnergy * 42)}px var(--accent-glow)"
              >
                <Cover src={trackArtwork(track, 't500x500')} size={290} radius={20} />
              </div>
            </div>

            <div class="mt-6 w-full max-w-[320px]" in:receive={{ key: 'np-meta' }} out:send={{ key: 'np-meta' }}>
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="truncate text-[20px] font-bold tracking-tight text-pure-white">{track.title}</div>
                  {#if track.user?.id}
                    <a
                      href="/artist/{track.user.id}"
                      class="mt-0.5 inline-block max-w-full truncate text-[14px] text-dim hover:text-pure-white hover:underline"
                      onclick={() => expandedOpen.set(false)}
                    >
                      {track.user.username}
                    </a>
                  {/if}
                </div>
                <button
                  class="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full {liked
                    ? 'text-pure-white'
                    : 'text-dim hover:text-pure-white'}"
                  onclick={like}
                  aria-label={$lang === 'ru' ? 'Лайк' : 'Like'}
                >
                  <Icon name={liked ? 'heart-fill' : 'heart'} size={18} />
                </button>
              </div>

              <div class="mt-5">
                <Slider value={livePos} max={totalSec} height={4} label={$lang === 'ru' ? 'Позиция' : 'Seek'} onchange={(v) => playerActions.seek(v)} />
                <div class="mt-1 flex justify-between text-[11px] text-dim">
                  <span>{formatTime(livePos)}</span>
                  <span>{formatTime(totalSec)}</span>
                </div>
              </div>

              <div class="mt-4 flex items-center justify-between">
                <button
                  class="flex h-9 w-9 items-center justify-center rounded-full {$player.shuffle
                    ? 'text-pure-white'
                    : 'text-dim hover:text-pure-white'}"
                  onclick={() => playerActions.toggleShuffle()}
                  aria-label={$lang === 'ru' ? 'Перемешать' : 'Shuffle'}
                >
                  <Icon name="shuffle" size={16} />
                </button>
                <button
                  class="flex h-10 w-10 items-center justify-center rounded-full text-dim hover:text-pure-white"
                  onclick={() => playerActions.prev()}
                  aria-label={$lang === 'ru' ? 'Предыдущий' : 'Previous'}
                >
                  <Icon name="prev" size={20} />
                </button>
                <button
                  class="accent-surface flex h-14 w-14 items-center justify-center rounded-full transition-transform hover:scale-105"
                  onclick={() => playerActions.toggle()}
                  aria-label={playing ? ($lang === 'ru' ? 'Пауза' : 'Pause') : ($lang === 'ru' ? 'Играть' : 'Play')}
                >
                  <Icon name={playing ? 'pause' : 'play'} size={22} />
                </button>
                <button
                  class="flex h-10 w-10 items-center justify-center rounded-full text-dim hover:text-pure-white"
                  onclick={() => playerActions.next()}
                  aria-label={$lang === 'ru' ? 'Следующий' : 'Next'}
                >
                  <Icon name="next" size={20} />
                </button>
                <button
                  class="flex h-9 w-9 items-center justify-center rounded-full {$player.repeat !== 'off'
                    ? 'text-pure-white'
                    : 'text-dim hover:text-pure-white'}"
                  onclick={() => playerActions.cycleRepeat()}
                  aria-label={$lang === 'ru' ? 'Повтор' : 'Repeat'}
                >
                  <Icon name={$player.repeat === 'one' ? 'repeat-one' : 'repeat'} size={16} />
                </button>
              </div>

              {@render modeButtons()}
            </div>
          {:else}
            <div class="text-[14px] text-dim">{$lang === 'ru' ? 'Ничего не играет' : 'Nothing playing'}</div>
          {/if}
        </div>

        <div
          class="scroll-y min-h-0 rounded-3xl bg-pure-black/45 p-8 backdrop-blur-2xl"
          style="box-shadow: inset 0 0 0 1px rgba(255,255,255,0.12)"
          in:fade={{ duration: 160 }}
        >
          {#if tab === 'queue'}
            <div class="space-y-1">
              {#each $player.queue as q, i (q.id + '-' + i)}
                {@const active = i === $player.index}
                <div
                  class="group flex items-center gap-3 rounded-xl px-3 py-2 transition-colors {active
                    ? 'bg-surface-2 text-pure-white'
                    : 'text-dim hover:bg-hover hover:text-pure-white'}"
                >
                  <button class="flex min-w-0 flex-1 items-center gap-3 text-left" onclick={() => playerActions.playIndex(i)}>
                    <Cover src={trackArtwork(q, 't120x120')} size={38} radius={6} />
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-[13px] font-medium text-pure-white">{q.title}</div>
                      <div class="truncate text-[12px] text-dim">{q.user?.username}</div>
                    </div>
                  </button>
                  <span class="text-[12px] text-dim">{formatTime(q.duration / 1000)}</span>
                  {#if !active}
                    <button
                      class="opacity-0 group-hover:opacity-100 text-dim hover:text-pure-white"
                      onclick={() => playerActions.removeAt(i)}
                      aria-label={$lang === 'ru' ? 'Удалить' : 'Remove'}
                    >
                      <Icon name="x" size={14} />
                    </button>
                  {/if}
                </div>
              {:else}
                <div class="py-12 text-center text-[13px] text-dim">{$lang === 'ru' ? 'Очередь пуста' : 'Queue is empty'}</div>
              {/each}
            </div>
          {:else}
            <EqPanel />
          {/if}
        </div>
      {/if}
    </div>

    <Visualizer bind:this={vis} active={$expandedOpen && playing} />
  </div>
{/if}
