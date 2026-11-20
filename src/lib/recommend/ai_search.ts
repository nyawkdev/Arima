import { score } from '$lib/recommend/engine';
import type { TasteProfile, Track } from '$lib/types';

const EN_TO_RU: Record<string, string> = {
  q:'й',w:'ц',e:'у',r:'к',t:'е',y:'н',u:'г',i:'ш',o:'щ',p:'з','[':'х',']':'ъ',
  a:'ф',s:'ы',d:'в',f:'а',g:'п',h:'р',j:'о',k:'л',l:'д',';':'ж',"'":'э',
  z:'я',x:'ч',c:'с',v:'м',b:'и',n:'т',m:'ь',',':'б','.':'ю'
};

const MOOD_MAP: [RegExp, string][] = [
  [/грустн|печал|тоск|депрес/i, 'sad lofi ambient'],
  [/ноч|перед сном|сон|спать|спокойн/i, 'night ambient chill'],
  [/машин|дорог|трасс|ночной город/i, 'phonk night drive bass'],
  [/трениров|спорт|зал|бег|кач/i, 'workout phonk trap energy'],
  [/учеба|работ|фокус|концентр/i, 'lofi chill beats focus'],
  [/дожд|осен/i, 'rainy lofi ambient'],
  [/рейв|клуб|вечерин|тусов/i, 'techno electronic rave']
];

export function flipKeyboardLayout(q: string): string | null {
  if (!/^[a-z\[\];',.\/\s]+$/i.test(q)) return null;
  let out = '';
  for (const ch of q.toLowerCase()) {
    out += EN_TO_RU[ch] ?? ch;
  }
  return out === q.toLowerCase() ? null : out;
}

export function aiExpandQuery(raw: string): { query: string; note: string | null } {
  const q = raw.trim();
  for (const [re, expansion] of MOOD_MAP) {
    if (re.test(q)) return { query: expansion, note: `ИИ-подбор по запросу «${q}»` };
  }
  const flipped = flipKeyboardLayout(q);
  if (flipped && MOOD_MAP.some(([re]) => re.test(flipped))) {
    const hit = MOOD_MAP.find(([re]) => re.test(flipped))!;
    return { query: hit[1], note: `ИИ: исправлена раскладка (${flipped})` };
  }
  return { query: q, note: null };
}

export function rerankTracks(tracks: Track[], rawQuery: string, taste: TasteProfile | null): Track[] {
  const tokens = rawQuery.toLowerCase().split(/\s+/).filter(Boolean);
  return [...tracks].sort((a, b) => {
    const rankOne = (t: Track): number => {
      const title = (t.title ?? '').toLowerCase();
      const artist = (t.user?.username ?? '').toLowerCase();
      let s = 0;
      for (const tok of tokens) {
        if (title.includes(tok)) s += 1.4;
        if (artist.includes(tok)) s += 1.1;
      }
      if (title.startsWith(tokens[0] ?? '')) s += 0.8;
      s += Math.min(1.5, Math.log10((t.playback_count ?? 0) + 10) / 5);
      if (taste) s += score(t, taste) * 1.2;
      return s;
    };
    return rankOne(b) - rankOne(a);
  });
}
