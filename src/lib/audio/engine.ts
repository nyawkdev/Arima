import type Hls from 'hls.js';
import type { ResolvedStream } from '$lib/api/soundcloud';

export type EngineState = 'idle' | 'loading' | 'playing' | 'paused' | 'buffering';
export type RemixMode = 'original' | 'slowed' | 'slowed-reverb' | 'speedup' | 'nightcore';

export interface EngineEvents {
  state(s: EngineState): void;
  time(current: number, duration: number): void;
  ended(): void;
  error(message: string): void;
}

const MAX_NETWORK_RETRIES = 3;

interface Deck {
  el: HTMLAudioElement;
  hls: Hls | null;
  gain: GainNode | null;
  srcNode: MediaElementAudioSourceNode | null;
  retries: number;
  token: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private preampNode!: GainNode;
  private bands: BiquadFilterNode[] = [];
  private bassFilter!: BiquadFilterNode;
  private dryGain!: GainNode;
  private wetGain!: GainNode;
  private convolver!: ConvolverNode;
  private masterGain!: GainNode;
  analyser: AnalyserNode | null = null;
  private volume = 0.8;
  private preampDb = 0;
  private autoGainDb = 0;
  private remixMode: RemixMode = 'original';
  private bassBoostPct = 0;
  private timeBuf = new Uint8Array(512);
  private eqGains: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  private sinkId = '';

  private decks: [Deck, Deck];
  private activeIdx: 0 | 1 = 0;
  private fadeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private events: EngineEvents) {
    this.decks = [this.createDeck(0), this.createDeck(1)];
  }

  private get active(): Deck {
    return this.decks[this.activeIdx];
  }

  private get standby(): Deck {
    return this.decks[this.activeIdx === 0 ? 1 : 0];
  }

  private createDeck(idx: 0 | 1): Deck {
    const el = new Audio();
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';
    const deck: Deck = { el, hls: null, gain: null, srcNode: null, retries: 0, token: 0 };

    el.addEventListener('playing', () => {
      if (this.activeIdx === idx) this.events.state('playing');
    });
    el.addEventListener('pause', () => {
      if (this.activeIdx === idx && !el.ended) this.events.state('paused');
    });
    el.addEventListener('waiting', () => {
      if (this.activeIdx === idx) this.events.state('buffering');
    });
    el.addEventListener('timeupdate', () => {
      if (this.activeIdx === idx) {
        this.updateAutoLoudness();
        this.events.time(el.currentTime, el.duration || 0);
      }
    });
    el.addEventListener('durationchange', () => {
      if (this.activeIdx === idx) this.events.time(el.currentTime, el.duration || 0);
    });
    el.addEventListener('ended', () => {
      if (this.activeIdx === idx) this.events.ended();
    });
    el.addEventListener('error', () => {
      if (this.activeIdx !== idx) return;
      if (!el.src && !deck.hls) return;
      this.events.error(el.error?.message || 'Не удалось воспроизвести трек.');
    });
    return deck;
  }

  private ensureGraph(): AudioContext {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext({ latencyHint: 'playback' });
    this.preampNode = ctx.createGain();
    this.preampNode.gain.value = Math.pow(10, this.preampDb / 20);

    const freqs = [60, 230, 910, 3600, 14000];
    this.bands = freqs.map((f, i) => {
      const n = ctx.createBiquadFilter();
      n.type = i === 0 ? 'lowshelf' : i === freqs.length - 1 ? 'highshelf' : 'peaking';
      n.frequency.value = f;
      n.Q.value = 1.0;
      n.gain.value = this.eqGains[i] ?? 0;
      return n;
    });

    this.bassFilter = ctx.createBiquadFilter();
    this.bassFilter.type = 'lowshelf';
    this.bassFilter.frequency.value = 85;
    this.bassFilter.gain.value = (this.bassBoostPct / 100) * 15;

    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = 1;
    this.wetGain = ctx.createGain();
    this.wetGain.gain.value = 0;
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = this.buildReverbImpulse(ctx);

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.78;
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.volume;

    let head: AudioNode = this.preampNode;
    for (const b of this.bands) head = head.connect(b);
    head = head.connect(this.bassFilter);
    head.connect(this.dryGain).connect(this.analyser);
    head.connect(this.convolver).connect(this.wetGain).connect(this.analyser);
    this.analyser.connect(this.masterGain).connect(ctx.destination);

    this.decks.forEach((d, i) => {
      d.srcNode = ctx.createMediaElementSource(d.el);
      d.gain = ctx.createGain();
      d.gain.gain.value = i === this.activeIdx ? 1 : 0;
      d.srcNode.connect(d.gain).connect(this.preampNode);
    });

    this.ctx = ctx;
    this.applyRemixToAudio();
    if (this.sinkId) void this.applySink();
    return ctx;
  }

  private buildReverbImpulse(ctx: AudioContext): AudioBuffer {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * 2.3);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const decay = Math.pow(1 - i / len, 2.6);
        data[i] = (Math.random() * 2 - 1) * decay * 0.65;
      }
    }
    return buf;
  }

  setRemix(mode: RemixMode, bassBoostPct: number): void {
    this.remixMode = mode;
    this.bassBoostPct = Math.max(0, Math.min(100, bassBoostPct));
    this.applyRemixToAudio();
  }

  private applyRemixToAudio(): void {
    const rate =
      this.remixMode === 'slowed' || this.remixMode === 'slowed-reverb'
        ? 0.84
        : this.remixMode === 'speedup'
          ? 1.2
          : this.remixMode === 'nightcore'
            ? 1.24
            : 1.0;
    const preservePitch = this.remixMode === 'original' || this.remixMode === 'speedup';

    for (const d of this.decks) {
      d.el.playbackRate = rate;
      (d.el as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = preservePitch;
    }

    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const hasReverb = this.remixMode === 'slowed-reverb';
    this.wetGain.gain.setTargetAtTime(hasReverb ? 0.36 : 0, now, 0.05);
    this.dryGain.gain.setTargetAtTime(hasReverb ? 0.85 : 1, now, 0.05);
    this.bassFilter.gain.setTargetAtTime((this.bassBoostPct / 100) * 15, now, 0.04);
  }

  private async applySink(): Promise<void> {
    const ctx = this.ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (ctx?.setSinkId) await ctx.setSinkId(this.sinkId).catch(() => undefined);
  }

  async setOutputDevice(id: string): Promise<void> {
    this.sinkId = id;
    await this.applySink();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.015);
    }
  }

  setEq(gains: [number, number, number, number, number], preampDb = 0): void {
    this.eqGains = [...gains];
    this.preampDb = preampDb;
    if (!this.ctx) return;
    this.preampNode.gain.setTargetAtTime(Math.pow(10, (preampDb + this.autoGainDb) / 20), this.ctx.currentTime, 0.015);
    this.bands.forEach((b, i) => {
      b.gain.setTargetAtTime(gains[i] ?? 0, this.ctx!.currentTime, 0.015);
    });
  }

  readRms(): number {
    if (!this.analyser || this.ctx?.state !== 'running') return 0;
    this.analyser.getByteTimeDomainData(this.timeBuf);
    let sumSq = 0;
    for (let i = 0; i < this.timeBuf.length; i++) {
      const n = (this.timeBuf[i] - 128) / 128;
      sumSq += n * n;
    }
    return Math.sqrt(sumSq / this.timeBuf.length);
  }

  private updateAutoLoudness(): void {
    if (!this.ctx || !this.analyser || this.ctx.state !== 'running') return;
    const rms = this.readRms();

    if (rms < 0.025) return;
    const targetRms = 0.16;
    const errDb = 20 * Math.log10(targetRms / rms);
    const clampedErr = Math.max(-4, Math.min(4, errDb));
    this.autoGainDb = this.autoGainDb * 0.9 + clampedErr * 0.1;
    const totalDb = this.preampDb + this.autoGainDb;
    this.preampNode.gain.setTargetAtTime(Math.pow(10, totalDb / 20), this.ctx.currentTime, 1.8);
  }

  readSpectrum(out: Uint8Array<ArrayBuffer>): boolean {
    if (!this.analyser || this.ctx?.state !== 'running') return false;
    this.analyser.getByteFrequencyData(out);
    return true;
  }

  get currentTime(): number {
    return this.active.el.currentTime;
  }

  get hasSource(): boolean {
    return !!this.active.el.src || !!this.active.hls;
  }

  private teardownDeck(d: Deck): void {
    if (d.hls) {
      d.hls.destroy();
      d.hls = null;
    }
    d.el.pause();
    d.el.removeAttribute('src');
    d.el.load();
  }

  private async attachStream(d: Deck, stream: ResolvedStream): Promise<void> {
    const token = ++d.token;
    d.retries = 0;
    if (d.hls) {
      d.hls.destroy();
      d.hls = null;
    }
    if (stream.protocol === 'hls') {
      const { default: HlsCtor } = await import('hls.js');
      if (token !== d.token) return;
      if (HlsCtor.isSupported()) {
        const hls = new HlsCtor({
          enableWorker: true,
          lowLatencyMode: false,
          maxBufferLength: 40,
          backBufferLength: 20,
          manifestLoadingMaxRetry: 2,
          fragLoadingMaxRetry: 3
        });
        d.hls = hls;
        hls.on(HlsCtor.Events.ERROR, (_e, data) => {
          if (!data.fatal) return;
          if (data.type === HlsCtor.ErrorTypes.NETWORK_ERROR && d.retries < MAX_NETWORK_RETRIES) {
            d.retries++;
            hls.startLoad();
          } else if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR && d.retries < MAX_NETWORK_RETRIES) {
            d.retries++;
            hls.recoverMediaError();
          } else if (this.active === d) {
            this.events.error('Не удалось загрузить поток.');
          }
        });
        hls.loadSource(stream.url);
        hls.attachMedia(d.el);
      } else {
        d.el.src = stream.url;
      }
    } else {
      d.el.src = stream.url;
    }
  }

  async load(stream: ResolvedStream, autoplay = true): Promise<void> {
    clearTimeout(this.fadeTimer);
    this.autoGainDb = 0;
    const ctx = this.ensureGraph();
    const cur = this.active;
    const other = this.standby;
    this.teardownDeck(other);
    if (other.gain) other.gain.gain.setValueAtTime(0, ctx.currentTime);
    if (cur.gain) cur.gain.gain.setValueAtTime(1, ctx.currentTime);

    this.events.state('loading');
    await this.attachStream(cur, stream);
    this.applyRemixToAudio();
    if (autoplay) await this.play();
  }

  async crossfadeTo(stream: ResolvedStream, fadeSec = 4.5): Promise<void> {
    clearTimeout(this.fadeTimer);
    this.autoGainDb = 0;
    const ctx = this.ensureGraph();
    if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);

    const outgoing = this.active;
    const incoming = this.standby;
    this.activeIdx = this.activeIdx === 0 ? 1 : 0;

    if (incoming.gain) incoming.gain.gain.setValueAtTime(0, ctx.currentTime);
    await this.attachStream(incoming, stream);
    this.applyRemixToAudio();
    await incoming.el.play().catch((e: DOMException) => {
      if (e.name !== 'AbortError') this.events.error(e.message);
    });

    const steps = 24;
    const outCurve = new Float32Array(steps);
    const inCurve = new Float32Array(steps);
    for (let i = 0; i < steps; i++) {
      const x = i / (steps - 1);

      outCurve[i] = Math.cos(x * Math.PI * 0.5);
      inCurve[i] = Math.sin(x * Math.PI * 0.5);
    }

    const now = ctx.currentTime;
    try {
      outgoing.gain?.gain.setValueCurveAtTime(outCurve, now, fadeSec);
      incoming.gain?.gain.setValueCurveAtTime(inCurve, now, fadeSec);
    } catch {
      outgoing.gain?.gain.linearRampToValueAtTime(0, now + fadeSec);
      incoming.gain?.gain.linearRampToValueAtTime(1, now + fadeSec);
    }

    this.fadeTimer = setTimeout(() => {
      this.teardownDeck(outgoing);
    }, fadeSec * 1000 + 150);
  }

  async play(): Promise<void> {
    const ctx = this.ensureGraph();
    if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
    await this.active.el.play().catch((e: DOMException) => {
      if (e.name !== 'AbortError') this.events.error(e.message);
    });
  }

  pause(): void {
    this.active.el.pause();
  }

  seek(sec: number): void {
    if (Number.isFinite(sec)) this.active.el.currentTime = Math.max(0, sec);
  }

  stop(): void {
    clearTimeout(this.fadeTimer);
    this.teardownDeck(this.decks[0]);
    this.teardownDeck(this.decks[1]);
    this.events.state('idle');
  }
}
