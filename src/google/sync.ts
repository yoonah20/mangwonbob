// 구글 평점 동기화: 짝 없는 곳은 찾아서 짝짓고, 25일 넘은 평점은 다시 받는다.
// 저녁 후보(카페·빵집 제외, 800m 안)만 대상이고, 등급별 월 호출 수를 DB에 세서 무료 한도를 넘지 않는다.
import { pool } from '../db/pool.js';
import * as places from '../db/places.js';
import { kindOf, NOT_DINNER } from '../domain/kinds.js';
import { bestMatch } from '../domain/match.js';
import { haversineM } from '../kakao/client.js';
import { searchNear, getRating } from './client.js';
import { config } from '../config.js';

type Sku = 'search' | 'details';

function monthKey(sku: Sku): string {
  const ym = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' })
    .format(new Date());
  return `google_calls:${ym}:${sku}`;
}

async function used(sku: Sku): Promise<number> {
  const { rows } = await pool.query('SELECT value FROM app_meta WHERE key = $1', [monthKey(sku)]);
  return Number(rows[0]?.value ?? 0);
}

async function count(sku: Sku): Promise<void> {
  await pool.query(
    `INSERT INTO app_meta (key, value) VALUES ($1, '1')
     ON CONFLICT (key) DO UPDATE SET value = (app_meta.value::int + 1)::text, updated_at = now()`,
    [monthKey(sku)]);
}

const isCandidate = (p: places.GoogleTodo) =>
  !NOT_DINNER.has(kindOf(p.categoryPath, p.kindOverride)) && (p.distanceM ?? 0) <= 800;

export async function syncGoogle(log: (m: string) => void = console.log): Promise<{ matched: number; failed: number; refreshed: number }> {
  const limit = config.googleMonthlyLimit;
  let matched = 0, failed = 0, refreshed = 0;

  // 짝짓기를 먼저 해야 같은 달에 평점까지 받는다
  for (const p of (await places.placesNeedingGoogleMatch()).filter(isCandidate)) {
    if (await used('search') >= limit) { log('구글 장소 찾기 월 한도 도달'); break; }
    await count('search');
    const found = await searchNear(p.name, p.lat, p.lng);
    const id = bestMatch(p.name, found.map(c => ({
      id: c.id, name: c.name, distanceM: haversineM({ lat: p.lat, lng: p.lng }, { lat: c.lat, lng: c.lng }),
    })));
    await places.setGoogleMatch(p.id, id);
    id ? matched++ : failed++;
  }

  for (const p of (await places.placesNeedingGoogleRefresh()).filter(isCandidate)) {
    if (await used('details') >= limit) { log('구글 평점 월 한도 도달'); break; }
    await count('details');
    const r = await getRating(p.googlePlaceId!);
    await places.setGoogleRating(p.id, r.rating, r.count);
    refreshed++;
  }

  await places.expireStaleGoogleRatings();
  log(`구글 동기화: 짝지음 ${matched}, 못 찾음 ${failed}, 평점 갱신 ${refreshed}`);
  return { matched, failed, refreshed };
}
