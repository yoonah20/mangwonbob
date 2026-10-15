// 오늘의 추천(모두가 같은 결과)과 개인별 다시 뽑기를 DB와 이어 붙인다.
import { recommend, type Pick } from './domain/recommend.js';
import type { Mood } from './domain/kinds.js';
import * as places from './db/places.js';

export function seoulDay(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function todayPicks(now = new Date()): Promise<Pick[]> {
  const day = seoulDay(now);
  const saved = await places.getDailyPicks(day);
  if (saved.length) return saved;

  const [all, recent] = await Promise.all([
    places.loadPlacesForRecommend(),
    places.recentlyPickedIds(addDays(day, -7), day),
  ]);
  const picks = recommend(all, { seed: day, now, recentlyPicked: recent });
  await places.saveDailyPicks(day, picks);
  // 동시에 저장했을 수 있으니 저장된 쪽을 다시 읽는다
  const stored = await places.getDailyPicks(day);
  return stored.length ? stored : picks;
}

export async function rerollPicks(opts: {
  userId: string; round: number; exclude: number[]; mood: Mood | null; now?: Date;
}): Promise<Pick[]> {
  const now = opts.now ?? new Date();
  const day = seoulDay(now);
  const all = await places.loadPlacesForRecommend();
  return recommend(all, {
    seed: `${day}:${opts.userId}:${opts.round}:${opts.mood ?? ''}`,
    now,
    mood: opts.mood,
    exclude: new Set(opts.exclude),
  });
}
