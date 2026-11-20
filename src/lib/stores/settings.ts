import { writable, get } from 'svelte/store';
import { ipc, isTauri } from '$lib/api/arima';
import type { Settings } from '$lib/types';

export interface ThemePalette {
  id: string;
  label: string;
  bg: string;
  c1: string;
  c2?: string;
  gradient?: boolean;
}

export const THEME_PALETTES: ThemePalette[] = [
  { id: 'track', label: 'Под трек', bg: '#0c0c10', c1: '#a1a1aa' },
  { id: 'neutral', label: 'Neutral', bg: '#0e0e11', c1: '#ffffff' },
  { id: 'amoled', label: 'AMOLED', bg: '#000000', c1: '#ffffff' },
  { id: 'crimson', label: 'Crimson', bg: '#160b0e', c1: '#e11d48' },
  { id: 'nord', label: 'Nord', bg: '#161b24', c1: '#60a5fa' },
  { id: 'terminal', label: 'Terminal', bg: '#09140c', c1: '#16a34a' },
  { id: 'aqua', label: 'Aqua', bg: '#0c181d', c1: '#14b8a6' },
  { id: 'sunset', label: 'Sunset', bg: '#190f12', c1: '#ea580c', c2: '#f43f5e', gradient: true },
  { id: 'slate', label: 'Slate', bg: '#12161f', c1: '#4f7df3' }
];

export const defaultSettings: Settings = {
  closeToTray: true,
  autostart: false,
  startMinimized: false,
  proxy: '',
  cacheMaxMb: 512,
  discordEnabled: true,
  discordAppId: '1108081579965808701',
  island: {
    mode: 'always',
    style: 'island',
    position: 'top-center',
    offset: 12,
    hideInFullscreen: true,
    toggleHotkey: 'Ctrl+Alt+I'
  },
  audio: { outputDeviceId: '', volume: 0.8, preamp: 0, eqPreset: 'flat', eq: [0, 0, 0, 0, 0] },
  ui: {
    density: 'comfortable',
    visualizer: true,
    particleCount: 400,
    lyricsSize: 36,
    theme: 'dark',
    accentPreset: 'amoled',
    customAccent: '#ffffff',
    customAccent2: '#000000',
    customBg: '',
    customThemeName: 'Custom theme',
    hideDuplicates: true,
    hideRemixes: false,
    windowAnimations: false,
    language: 'en',
    onboardingDone: false
  }
};

export const trackDynamicAccent = writable<string>('#ffffff');
export const customWallpaper = writable<string>(
  typeof localStorage !== 'undefined' ? localStorage.getItem('arima:custom-wallpaper') ?? '' : ''
);

export function setCustomWallpaper(dataUrl: string): void {
  if (typeof localStorage !== 'undefined') {
    try {
      if (dataUrl) localStorage.setItem('arima:custom-wallpaper', dataUrl);
      else localStorage.removeItem('arima:custom-wallpaper');
    } catch {

    }
  }
  customWallpaper.set(dataUrl);
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
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

function contrastFg(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? '#000000' : '#ffffff';
}

export async function extractCoverAccent(url: string | undefined): Promise<void> {
  if (!url || typeof document === 'undefined') return;
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej();
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 24;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, 24, 24);
    const data = ctx.getImageData(0, 0, 24, 24).data;
    let bestR = 255;
    let bestG = 255;
    let bestB = 255;
    let bestScore = -1;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max > 0 ? (max - min) / max : 0;
      const lum = (r + g + b) / (3 * 255);
      if (lum < 0.18 || lum > 0.92) continue;
      const score = sat * 2.2 + lum * 0.4;
      if (score > bestScore) {
        bestScore = score;
        bestR = r;
        bestG = g;
        bestB = b;
      }
    }
    const hex = `#${[bestR, bestG, bestB].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
    trackDynamicAccent.set(hex);
    applyThemeToDom(get(settings));
  } catch {

  }
}

export function applyThemeToDom(s: Settings): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const rawTheme = s.ui?.theme || 'dark';
  const resolvedTheme =
    rawTheme === 'system'
      ? window.matchMedia?.('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : rawTheme;
  root.setAttribute('data-theme', resolvedTheme);

  const presetId = s.ui?.accentPreset || 'amoled';
  let c1 = resolvedTheme === 'light' ? '#0e1018' : '#ffffff';
  let c2 = c1;
  let customBgHex: string | null = null;
  let isGrad = false;

  if (presetId === 'track') {
    c1 = get(trackDynamicAccent) || c1;
    c2 = c1;
  } else if (presetId === 'custom') {
    c1 = s.ui?.customAccent || '#ffffff';
    c2 = c1;
    if (resolvedTheme === 'dark' && s.ui?.customAccent2) {
      customBgHex = s.ui.customAccent2;
    }
  } else {
    const found = THEME_PALETTES.find((p) => p.id === presetId);
    if (found) {
      c1 = found.c1;
      if (resolvedTheme === 'light' && c1.toLowerCase() === '#ffffff') c1 = '#0e1018';
      c2 = found.c2 ?? c1;
      isGrad = !!found.gradient;
      if (resolvedTheme === 'dark' && found.bg !== '#000000') {
        customBgHex = found.bg;
      }
    }
  }

  if (customBgHex) {
    const [br, bg, bb] = hexToRgb(customBgHex);
    root.style.setProperty('--bg-rgb', `${br} ${bg} ${bb}`);
    root.style.setProperty('--bg', customBgHex);
    root.style.setProperty('--card-bg', `rgba(${Math.min(255, br + 10)}, ${Math.min(255, bg + 10)}, ${Math.min(255, bb + 12)}, 0.72)`);
  } else {
    root.style.removeProperty('--bg-rgb');
    root.style.removeProperty('--bg');
    root.style.removeProperty('--card-bg');
  }

  const [r, g, b] = hexToRgb(c1);
  const fg = contrastFg(c1);
  root.style.setProperty('--accent', c1);
  root.style.setProperty('--accent-2', c2);
  root.style.setProperty('--accent-bg', isGrad ? `linear-gradient(135deg, ${c1}, ${c2})` : c1);
  root.style.setProperty('--accent-fg', fg);
  root.style.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, 0.42)`);
  root.style.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, 0.15)`);
}

function merge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return (patch as T) ?? base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const b = out[k];
    out[k] =
      v && typeof v === 'object' && !Array.isArray(v) && b && typeof b === 'object'
        ? merge(b, v)
        : v;
  }
  return out as T;
}

export const settings = writable<Settings>(defaultSettings);

settings.subscribe((s) => {
  applyThemeToDom(s);
});

if (typeof window !== 'undefined' && window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (get(settings).ui?.theme === 'system') applyThemeToDom(get(settings));
  });
}

export async function loadSettings(): Promise<void> {
  try {
    settings.set(merge(defaultSettings, await ipc.settings.get()));
  } catch {
    settings.set(defaultSettings);
  }
  if (isTauri) {
    const { listen } = await import('@tauri-apps/api/event');
    await listen<Settings>('settings-changed', (e) =>
      settings.set(merge(defaultSettings, e.payload))
    );
  }
}

export async function updateSettings(patch: DeepPartial<Settings>): Promise<void> {
  settings.set(merge(get(settings), patch));
  try {
    settings.set(merge(defaultSettings, await ipc.settings.set(patch)));
  } catch {

  }
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
