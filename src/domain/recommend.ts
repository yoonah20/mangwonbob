// 새 밥집 추천 규칙. 우리 중 아무도 안 가 본 곳만 고른다.
// DB나 슬랙을 모르는 순수 함수라서 테스트로 바로 검증한다.
import { kindOf, isChain, isTakeoutOnly, detailOf, matchesMood, NOT_DINNER, type Kind, type Mood } from './kinds.js';

export interface PlaceInput {
  id: number;
  name: string;
  categoryPath: string | null;
  kindOverride: string | null;
  distanceM: number | null;
  firstSeenAt: Date;
  source: 'legacy' | 'collect' | 'manual';
  kakaoUrl: string | null;
  googleRating: number | null;
  googleRatingCount: number | null;
  // 팀 기록
  ups: number;
  mehs: number;
  downs: number;
  visits: number;
  wishedBy: string[];
}

export interface Pick {
  placeId: number;
  name: string;
  kind: Kind;
  detail: string;
  distanceM: number | null;
  kakaoUrl: string | null;
  googleRating: number | null;
  googleRatingCount: number | null;
  reason: string;
}

export interface RecommendOptions {
  seed: string;
  now: Date;
  count?: number;
  mood?: Mood | null;
  exclude?: ReadonlySet<number>;
  recentlyPicked?: ReadonlySet<number>;
  maxDistanceM?: number;
}

const DAY = 24 * 60 * 60 * 1000;
const NEW_WINDOW_DAYS = 90;

// 구글 평점은 리뷰가 적으면 덜 믿는다: 평균 4.1점에 리뷰 15개를 깔아 두고 섞는다
const PRIOR_RATING = 4.1;
const PRIOR_COUNT = 15;

export function adjustedRating(rating: number | null, count: number | null): number | null {
  if (rating == null || !count) return null;
  return (PRIOR_RATING * PRIOR_COUNT + rating * count) / (PRIOR_COUNT + count);
}

// ── 점수 ──────────────────────────────────────────

interface Scored { place: PlaceInput; kind: Kind; score: number; reason: string }

// 종류별 팀 취향: (👍 - 👎) / (평가 수 + 2), -1 ~ 1
export function kindTaste(places: PlaceInput[]): Map<Kind, number> {
  const acc = new Map<Kind, { net: number; n: number }>();
  for (const p of places) {
    const n = p.ups + p.mehs + p.downs;
    if (!n) continue;
    const k = kindOf(p.categoryPath, p.kindOverride);
    const a = acc.get(k) ?? { net: 0, n: 0 };
    a.net += p.ups - p.downs;
    a.n += n;
    acc.set(k, a);
  }
  return new Map([...acc].map(([k, a]) => [k, a.net / (a.n + 2)]));
}

function triedKinds(places: PlaceInput[]): Set<Kind> {
  return new Set(places.filter(p => p.visits > 0 || p.ups + p.mehs + p.downs > 0)
    .map(p => kindOf(p.categoryPath, p.kindOverride)));
}

function distancePenalty(d: number | null): number {
  if (d == null) return 0.3;
  return Math.max(0, (d - 300) / 500);
}

function score(p: PlaceInput, kind: Kind, taste: Map<Kind, number>, tried: Set<Kind>,
  now: Date, recent: ReadonlySet<number>): Scored {
  const parts: Array<[number, string]> = [];
  const t = taste.get(kind) ?? 0;
  const adj = adjustedRating(p.googleRating, p.googleRatingCount);

  if (p.wishedBy.length) parts.push([1.5, `${p.wishedBy.map(u => `<@${u}>`).join(' ')} 님이 찜해 둔 곳`]);
  if (p.source === 'collect' && now.getTime() - p.firstSeenAt.getTime() < NEW_WINDOW_DAYS * DAY) {
    parts.push([1.0, '최근에 새로 생긴 곳']);
  }
  if (adj != null) {
    const q = (adj - PRIOR_RATING) * 3;
    parts.push([q, q > 0.6 ? '구글 평점이 높은 곳' : '']);
  }
  if (!tried.has(kind) && kind !== '기타') parts.push([0.6, `우리가 아직 한 번도 안 가 본 ${kind}`]);
  if (t > 0.15) parts.push([1.2 * t, `${kind}에 '또 갈래'가 많았던 우리 취향`]);
  else if (t < 0) parts.push([1.2 * t, '']);

  let s = 1 + parts.reduce((sum, [v]) => sum + v, 0);
  if (isChain(p.name, p.categoryPath)) s -= 1.5;
  s -= distancePenalty(p.distanceM);
  if (recent.has(p.id)) s -= 2.0;

  const best = parts.filter(([v, r]) => v > 0 && r).sort((a, b) => b[0] - a[0])[0];
  const reason = best?.[1] ?? '우리 중 아직 아무도 안 가 본 곳';
  return { place: p, kind, score: Math.max(0.05, s), reason };
}

// ── 뽑기 ──────────────────────────────────────────

// 같은 seed면 같은 결과가 나오는 난수 (mulberry32)
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 점수의 제곱에 비례해 뽑는다. 상위권이 자주 나오지만 매번 같지는 않다.
// 가능하면 종류가 겹치지 않게 고른다.
function weightedTake(pool: Scored[], n: number, rand: () => number): Scored[] {
  const out: Scored[] = [];
  const usedKinds = new Set<Kind>();
  let rest = pool.slice();
  while (out.length < n && rest.length) {
    const fresh = rest.filter(s => !usedKinds.has(s.kind));
    const from = fresh.length ? fresh : rest;
    const total = from.reduce((s, x) => s + x.score ** 2, 0);
    let r = rand() * total;
    let chosen = from[from.length - 1];
    for (const x of from) {
      r -= x.score ** 2;
      if (r <= 0) { chosen = x; break; }
    }
    out.push(chosen);
    usedKinds.add(chosen.kind);
    rest = rest.filter(x => x !== chosen);
  }
  return out;
}

export function recommend(places: PlaceInput[], opts: RecommendOptions): Pick[] {
  const maxD = opts.maxDistanceM ?? 800;
  const exclude = opts.exclude ?? new Set<number>();
  const recent = opts.recentlyPicked ?? new Set<number>();
  const taste = kindTaste(places);
  const tried = triedKinds(places);

  const pool: Scored[] = [];
  for (const p of places) {
    const kind = kindOf(p.categoryPath, p.kindOverride);
    if (NOT_DINNER.has(kind) || exclude.has(p.id) || isTakeoutOnly(p.name, p.categoryPath)) continue;
    if (p.visits > 0 || p.ups + p.mehs + p.downs > 0) continue;
    if (p.distanceM != null && p.distanceM > maxD) continue;
    if (opts.mood && !matchesMood(opts.mood, kind, p.categoryPath)) continue;
    pool.push(score(p, kind, taste, tried, opts.now, recent));
  }

  return weightedTake(pool, opts.count ?? 3, seededRandom(opts.seed)).map(s => ({
    placeId: s.place.id,
    name: s.place.name,
    kind: s.kind,
    detail: detailOf(s.place.categoryPath, s.kind),
    distanceM: s.place.distanceM,
    kakaoUrl: s.place.kakaoUrl,
    googleRating: s.place.googleRating,
    googleRatingCount: s.place.googleRatingCount,
    reason: s.reason,
  }));
}
