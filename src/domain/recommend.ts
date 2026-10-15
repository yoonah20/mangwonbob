// 추천 점수 규칙. DB나 슬랙을 모르는 순수 함수라서 테스트로 바로 검증한다.
import { kindOf, isChain, matchesMood, NOT_DINNER, type Kind, type Mood } from './kinds.js';

export interface PlaceInput {
  id: number;
  name: string;
  categoryPath: string | null;
  kindOverride: string | null;
  distanceM: number | null;
  firstSeenAt: Date;
  source: 'legacy' | 'collect' | 'manual';
  kakaoUrl: string | null;
  // 팀 기록
  ups: number;
  mehs: number;
  downs: number;
  visits: number;
  lastVisitedAt: Date | null;
  bestComment: string | null;
  wishedBy: string[];
}

export interface Pick {
  placeId: number;
  name: string;
  kind: Kind;
  distanceM: number | null;
  kakaoUrl: string | null;
  verified: boolean;
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

// ── 점수 ──────────────────────────────────────────

interface Scored { place: PlaceInput; kind: Kind; score: number; reason: string; verified: boolean }

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

function scoreUnvisited(p: PlaceInput, kind: Kind, taste: Map<Kind, number>, tried: Set<Kind>,
  now: Date, recent: ReadonlySet<number>): Scored {
  const parts: Array<[number, string]> = [];
  const t = taste.get(kind) ?? 0;
  if (p.wishedBy.length) parts.push([1.5, `${p.wishedBy.map(u => `<@${u}>`).join(' ')} 님이 가고 싶다고 찜한 곳`]);
  if (p.source === 'collect' && now.getTime() - p.firstSeenAt.getTime() < NEW_WINDOW_DAYS * DAY) {
    parts.push([1.0, '최근에 새로 생긴 곳']);
  }
  if (!tried.has(kind)) parts.push([0.6, `우리가 아직 한 번도 안 가 본 ${kind}`]);
  if (t > 0.15) parts.push([1.2 * t, `${kind}에 👍가 많았던 우리 취향`]);
  else if (t < 0) parts.push([1.2 * t, '']);

  let score = 1 + parts.reduce((s, [v]) => s + v, 0);
  if (isChain(p.name, p.categoryPath)) score -= 1.0;
  score -= distancePenalty(p.distanceM);
  if (recent.has(p.id)) score -= 2.0;

  const best = parts.filter(([v, r]) => v > 0 && r).sort((a, b) => b[0] - a[0])[0];
  const reason = best?.[1] ?? `회사에서 ${p.distanceM ?? '?'}m, 아직 아무도 안 가 봄`;
  return { place: p, kind, score: Math.max(0.05, score), reason, verified: false };
}

function scoreVerified(p: PlaceInput, kind: Kind, now: Date, recent: ReadonlySet<number>): Scored {
  let score = 1 + 0.5 * (p.ups - p.downs) + (p.wishedBy.length ? 0.5 : 0);
  score -= distancePenalty(p.distanceM);
  if (p.lastVisitedAt && now.getTime() - p.lastVisitedAt.getTime() < 21 * DAY) score -= 1.0;
  if (recent.has(p.id)) score -= 2.0;
  const reason = p.bestComment ? `"${p.bestComment}"` : `👍 ${p.ups}`;
  return { place: p, kind, score: Math.max(0.05, score), reason, verified: true };
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
function weightedTake(pool: Scored[], n: number, rand: () => number, usedKinds: Set<Kind>): Scored[] {
  const out: Scored[] = [];
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
  const count = opts.count ?? 3;
  const maxD = opts.maxDistanceM ?? 800;
  const exclude = opts.exclude ?? new Set<number>();
  const recent = opts.recentlyPicked ?? new Set<number>();
  const taste = kindTaste(places);
  const tried = triedKinds(places);

  const verified: Scored[] = [];
  const unvisited: Scored[] = [];
  for (const p of places) {
    const kind = kindOf(p.categoryPath, p.kindOverride);
    if (NOT_DINNER.has(kind) || exclude.has(p.id)) continue;
    if (p.distanceM != null && p.distanceM > maxD) continue;
    if (opts.mood && !matchesMood(opts.mood, kind, p.categoryPath)) continue;
    const rated = p.ups + p.mehs + p.downs;
    if (p.ups > p.downs) verified.push(scoreVerified(p, kind, opts.now, recent));
    else if (p.visits === 0 && rated === 0) unvisited.push(scoreUnvisited(p, kind, taste, tried, opts.now, recent));
  }

  const rand = seededRandom(opts.seed);
  const usedKinds = new Set<Kind>();
  const picks = [
    ...weightedTake(verified, Math.min(1, count), rand, usedKinds),
  ];
  picks.push(...weightedTake(unvisited, count - picks.length, rand, usedKinds));
  if (picks.length < count) {
    const left = verified.filter(v => !picks.includes(v));
    picks.push(...weightedTake(left, count - picks.length, rand, usedKinds));
  }

  return picks.map(s => ({
    placeId: s.place.id,
    name: s.place.name,
    kind: s.kind,
    distanceM: s.place.distanceM,
    kakaoUrl: s.place.kakaoUrl,
    verified: s.verified,
    reason: s.reason,
  }));
}
