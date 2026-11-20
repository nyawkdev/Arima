import { writable } from 'svelte/store';
import type { Track } from '$lib/types';

export const menu = writable<{ x: number; y: number; track: Track } | null>(null);
export const picker = writable<Track | null>(null);

export interface Notice {
  text: string;
  id: number;
}
export const notice = writable<Notice | null>(null);
let nid = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

export function say(text: string, ms = 3500): void {
  clearTimeout(timer);
  notice.set({ text, id: ++nid });
  timer = setTimeout(() => notice.set(null), ms);
}

export const queueOpen = writable(false);
export const expandedOpen = writable(false);
