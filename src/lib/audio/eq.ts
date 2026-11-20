import type { Track } from '$lib/types';

export const EQ_BANDS = [
  { label: '60 Гц', freq: 60 },
  { label: '230 Гц', freq: 230 },
  { label: '910 Гц', freq: 910 },
  { label: '3.6 кГц', freq: 3600 },
  { label: '14 кГц', freq: 14000 }
] as const;

export type EqGains = [number, number, number, number, number];

export const EQ_PRESETS: { id: string; name: string; gains: EqGains }[] = [
  { id: 'flat', name: 'ИИ-Адаптивный', gains: [0, 0, 0, 0, 0] },
  { id: 'bass', name: 'Бас', gains: [6, 4, 0, -1, 0] },
  { id: 'vocal', name: 'Вокал', gains: [-2, 0, 4, 4, 1] },
  { id: 'club', name: 'Клуб', gains: [5, 3, 1, 3, 4] },
  { id: 'electronic', name: 'Электроника', gains: [5, 2, -1, 3, 5] },
  { id: 'soft', name: 'Мягкий', gains: [2, 1, 0, -2, -3] }
];

export function aiAdaptiveEq(track: Track | null): { gains: EqGains; label: string } {
  if (!track) return { gains: [0, 0, 0, 0, 0], label: 'ИИ-EQ: Нейтральный' };
  const text = `${track.genre ?? ''} ${track.tag_list ?? ''} ${track.title ?? ''} ${track.badge ?? ''}`.toLowerCase();

  if (/phonk|memphis|cowbell|drift/.test(text)) {
    return { gains: [3.5, 1.5, -0.8, 2.2, 2.5], label: 'ИИ-EQ: Phonk Punch' };
  }
  if (/trap|hip-hop|hip\s*hop|rap|drill|808/.test(text)) {
    return { gains: [3.2, 1.2, 0.4, 1.8, 1.6], label: 'ИИ-EQ: 808 & Vocal' };
  }
  if (/lofi|lo-fi|chill|ambient|sleep|study|piano|acoustic/.test(text)) {
    return { gains: [1.8, 1.4, 0.6, -1.0, -1.6], label: 'ИИ-EQ: Тёплый Lo-Fi' };
  }
  if (/electronic|house|techno|trance|edm|synth|cyber|dance|dnb|drum/.test(text)) {
    return { gains: [2.8, 1.0, -0.6, 1.8, 2.8], label: 'ИИ-EQ: Электроника' };
  }
  if (/rock|metal|punk|indie|guitar|alternative/.test(text)) {
    return { gains: [2.0, 0.8, 1.2, 2.2, 1.8], label: 'ИИ-EQ: Живой драйв' };
  }
  if (/slowed|reverb/.test(text)) {
    return { gains: [1.5, -0.5, 1.2, 2.4, 2.0], label: 'ИИ-EQ: Чёткость Slowed' };
  }
  return { gains: [1.6, 0.6, 0.4, 1.2, 1.4], label: 'ИИ-EQ: Студийный баланс' };
}
