import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommend, kindTaste, adjustedRating, type PlaceInput } from './recommend.js';
import { kindOf, matchesMood } from './kinds.js';

const now = new Date('2026-10-16T09:00:00Z');
let nextId = 1;
function place(over: Partial<PlaceInput>): PlaceInput {
  return {
    id: nextId++, name: `식당${nextId}`, categoryPath: '음식점 > 한식', kindOverride: null,
    distanceM: 200, firstSeenAt: new Date('2026-05-01'), source: 'legacy', kakaoUrl: null,
    googleRating: null, googleRatingCount: null,
    ups: 0, mehs: 0, downs: 0, visits: 0, wishedBy: [],
    ...over,
  };
}

test('kindOf groups kakao paths', () => {
  assert.equal(kindOf('음식점 > 한식 > 육류,고기 > 삼겹살'), '고기');
  assert.equal(kindOf('음식점 > 한식 > 해물,생선 > 회'), '해산물');
  assert.equal(kindOf('음식점 > 술집 > 일본식주점'), '술집');
  assert.equal(kindOf('음식점 > 카페 > 커피전문점 > 스타벅스'), '카페');
  assert.equal(kindOf('음식점 > 간식 > 제과,베이커리'), '빵·간식');
  assert.equal(kindOf('음식점 > 한식 > 국밥'), '한식');
  assert.equal(kindOf(null), '기타');
  assert.equal(kindOf('음식점 > 한식', '일식'), '일식');
});

test('moods', () => {
  assert.ok(matchesMood('국물', '한식', '음식점 > 한식 > 국밥'));
  assert.ok(!matchesMood('국물', '고기', '음식점 > 한식 > 육류,고기 > 삼겹살'));
  assert.ok(matchesMood('한잔', '해산물', '음식점 > 한식 > 해물,생선 > 회'));
});

test('only places nobody has been to, three different kinds', () => {
  const places = [
    place({ categoryPath: '음식점 > 한식 > 육류,고기', ups: 2, visits: 2 }),
    place({ categoryPath: '음식점 > 일식' }),
    place({ categoryPath: '음식점 > 중식' }),
    place({ categoryPath: '음식점 > 양식' }),
    place({ categoryPath: '음식점 > 양식 > 피자' }),
  ];
  const picks = recommend(places, { seed: 'a', now });
  assert.equal(picks.length, 3);
  assert.ok(!picks.some(p => p.placeId === places[0].id));
  assert.equal(new Set(picks.map(p => p.kind)).size, 3);
});

test('never recommends cafes, far places or anywhere we have been', () => {
  const bad = [
    place({ categoryPath: '음식점 > 카페' }),
    place({ categoryPath: '음식점 > 일식', distanceM: 1200 }),
    place({ categoryPath: '음식점 > 중식', downs: 1, visits: 1 }),
    place({ categoryPath: '음식점 > 양식', visits: 1 }),
  ];
  const good = place({ categoryPath: '음식점 > 분식' });
  for (const seed of ['1', '2', '3', '4', '5']) {
    const picks = recommend([...bad, good], { seed, now });
    assert.deepEqual(picks.map(p => p.placeId), [good.id]);
  }
});

test('same seed gives same picks, different seed varies', () => {
  const places = Array.from({ length: 40 }, (_, i) =>
    place({ categoryPath: ['음식점 > 일식', '음식점 > 중식', '음식점 > 양식', '음식점 > 분식', '음식점 > 아시아음식'][i % 5] }));
  const a = recommend(places, { seed: '2026-10-16', now }).map(p => p.placeId);
  const b = recommend(places, { seed: '2026-10-16', now }).map(p => p.placeId);
  assert.deepEqual(a, b);
  const seen = new Set<string>();
  for (let i = 0; i < 10; i++) seen.add(recommend(places, { seed: `s${i}`, now }).map(p => p.placeId).join());
  assert.ok(seen.size > 5);
});

test('takeout-only shops are never recommended', () => {
  const takeout = place({ name: '369 활어회포장전문', categoryPath: '음식점 > 한식 > 해물,생선 > 회' });
  const dineIn = place({ categoryPath: '음식점 > 일식' });
  for (const seed of ['1', '2', '3']) {
    assert.deepEqual(recommend([takeout, dineIn], { seed, now }).map(p => p.placeId), [dineIn.id]);
  }
});

test('cards show the detailed category', () => {
  const [p] = recommend([place({ categoryPath: '음식점 > 술집 > 일본식주점' })], { seed: 'd', now });
  assert.equal(p.detail, '일본식주점');
  const [q] = recommend([place({ categoryPath: '음식점 > 치킨 > 페리카나' })], { seed: 'd', now });
  assert.equal(q.detail, '치킨');
});

test('exclude and mood filters apply', () => {
  const soup = place({ categoryPath: '음식점 > 한식 > 국밥' });
  const meat = place({ categoryPath: '음식점 > 한식 > 육류,고기 > 갈비' });
  assert.deepEqual(recommend([soup, meat], { seed: 'x', now, mood: '국물' }).map(p => p.placeId), [soup.id]);
  assert.deepEqual(recommend([soup, meat], { seed: 'x', now, exclude: new Set([soup.id]) }).map(p => p.placeId), [meat.id]);
});

test('wished and new places lead with their reason', () => {
  const wished = place({ categoryPath: '음식점 > 일식', wishedBy: ['U1'] });
  const fresh = place({ categoryPath: '음식점 > 중식', source: 'collect', firstSeenAt: new Date('2026-10-01') });
  const picks = recommend([wished, fresh], { seed: 'x', now });
  const byId = new Map(picks.map(p => [p.placeId, p.reason]));
  assert.match(byId.get(wished.id)!, /<@U1>/);
  assert.equal(byId.get(fresh.id), '최근에 새로 생긴 곳');
});

test('google rating trusts many reviews more than a few', () => {
  assert.equal(adjustedRating(null, null), null);
  assert.ok(adjustedRating(4.8, 300)! > adjustedRating(5.0, 3)!);
  assert.ok(Math.abs(adjustedRating(4.1, 100)! - 4.1) < 1e-9);
});

test('well-rated places come up far more often than poorly rated ones', () => {
  const great = place({ categoryPath: '음식점 > 일식', googleRating: 4.7, googleRatingCount: 400 });
  const poor = place({ categoryPath: '음식점 > 일식 > 초밥,롤', googleRating: 3.2, googleRatingCount: 200 });
  let greatWins = 0;
  for (let i = 0; i < 200; i++) {
    if (recommend([great, poor], { seed: `g${i}`, now, count: 1 })[0].placeId === great.id) greatWins++;
  }
  assert.ok(greatWins > 180, `great won ${greatWins}/200`);
  const [pick] = recommend([great], { seed: 'r', now, count: 1 });
  assert.equal(pick.reason, '구글 평점이 높은 곳');
});

test('taste favours liked kinds', () => {
  const places = [
    place({ categoryPath: '음식점 > 한식 > 육류,고기', ups: 3, visits: 3 }),
    place({ categoryPath: '음식점 > 일식', downs: 3, visits: 3 }),
  ];
  const t = kindTaste(places);
  assert.ok(t.get('고기')! > 0.5);
  assert.ok(t.get('일식')! < -0.5);
});
