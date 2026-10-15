import { pool } from './pool.js';
import type { PlaceInput, Pick } from '../domain/recommend.js';
import { kindOf, detailOf } from '../domain/kinds.js';

// 추천에 필요한 모든 곳 + 팀 기록을 한 번에 읽는다. 1천 곳 남짓이라 통째로 읽어도 가볍다.
export async function loadPlacesForRecommend(): Promise<PlaceInput[]> {
  const { rows } = await pool.query(`
    SELECT p.id, p.name, p.category_path, p.kind_override, p.distance_m, p.first_seen_at,
           p.source, p.kakao_url, p.google_rating, p.google_rating_count,
           COALESCE(r.ups, 0)::int   AS ups,
           COALESCE(r.mehs, 0)::int  AS mehs,
           COALESCE(r.downs, 0)::int AS downs,
           COALESCE(v.n, 0)::int     AS visits,
           COALESCE(w.users, '{}')   AS wished_by
    FROM places p
    LEFT JOIN (
      SELECT place_id,
             COUNT(*) FILTER (WHERE verdict = 1)  AS ups,
             COUNT(*) FILTER (WHERE verdict = 0)  AS mehs,
             COUNT(*) FILTER (WHERE verdict = -1) AS downs
      FROM ratings GROUP BY place_id
    ) r ON r.place_id = p.id
    LEFT JOIN (SELECT place_id, COUNT(*) AS n FROM visits GROUP BY place_id) v ON v.place_id = p.id
    LEFT JOIN (SELECT place_id, ARRAY_AGG(slack_user_id) AS users FROM wishes GROUP BY place_id) w
      ON w.place_id = p.id
    WHERE NOT p.hidden`);
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    categoryPath: r.category_path,
    kindOverride: r.kind_override,
    distanceM: r.distance_m,
    firstSeenAt: r.first_seen_at,
    source: r.source,
    kakaoUrl: r.kakao_url,
    googleRating: r.google_rating,
    googleRatingCount: r.google_rating_count,
    ups: r.ups,
    mehs: r.mehs,
    downs: r.downs,
    visits: r.visits,
    wishedBy: r.wished_by,
  }));
}

// ── 오늘의 추천 ─────────────────────────────────────

export async function getDailyPicks(day: string): Promise<Pick[]> {
  const { rows } = await pool.query(`
    SELECT d.place_id, d.reason, p.name, p.category_path, p.kind_override, p.distance_m, p.kakao_url,
           p.google_rating, p.google_rating_count
    FROM daily_picks d JOIN places p ON p.id = d.place_id
    WHERE d.day = $1 AND NOT p.hidden
    ORDER BY d.slot`, [day]);
  return rows.map(r => {
    const kind = kindOf(r.category_path, r.kind_override);
    return {
    placeId: r.place_id,
    name: r.name,
    kind,
    detail: detailOf(r.category_path, kind),
    distanceM: r.distance_m,
    kakaoUrl: r.kakao_url,
    googleRating: r.google_rating,
    googleRatingCount: r.google_rating_count,
    reason: r.reason,
    };
  });
}

// 동시에 두 명이 처음 부르면 먼저 저장한 쪽이 이긴다 (ON CONFLICT DO NOTHING)
export async function saveDailyPicks(day: string, picks: Pick[]): Promise<void> {
  for (const [slot, p] of picks.entries()) {
    await pool.query(
      `INSERT INTO daily_picks (day, slot, place_id, reason) VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [day, slot, p.placeId, p.reason]);
  }
}

export async function recentlyPickedIds(sinceDay: string, beforeDay: string): Promise<Set<number>> {
  const { rows } = await pool.query(
    'SELECT DISTINCT place_id FROM daily_picks WHERE day >= $1 AND day < $2', [sinceDay, beforeDay]);
  return new Set(rows.map(r => r.place_id));
}

// ── 사람들이 남기는 것 ───────────────────────────────

export async function getPlaceName(placeId: number): Promise<string | null> {
  const { rows } = await pool.query('SELECT name FROM places WHERE id = $1', [placeId]);
  return rows[0]?.name ?? null;
}

// "가 봤어요": 방문 1건 + 평가 1건. 같은 사람이 같은 곳을 다시 평가하면 평가만 바꾼다.
export async function recordVisit(placeId: number, userId: string, verdict: -1 | 0 | 1): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO visits (place_id, slack_user_id, source) VALUES ($1, $2, 'slack')`, [placeId, userId]);
    const upd = await client.query(
      `UPDATE ratings SET verdict = $3, created_at = now()
       WHERE id = (SELECT id FROM ratings WHERE place_id = $1 AND slack_user_id = $2
                   ORDER BY created_at DESC LIMIT 1)`, [placeId, userId, verdict]);
    if (!upd.rowCount) {
      await client.query(
        'INSERT INTO ratings (place_id, slack_user_id, verdict) VALUES ($1, $2, $3)', [placeId, userId, verdict]);
    }
    await client.query('DELETE FROM wishes WHERE place_id = $1 AND slack_user_id = $2', [placeId, userId]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function toggleWish(userId: string, placeId: number): Promise<boolean> {
  const del = await pool.query('DELETE FROM wishes WHERE slack_user_id = $1 AND place_id = $2', [userId, placeId]);
  if (del.rowCount) return false;
  await pool.query('INSERT INTO wishes (slack_user_id, place_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, placeId]);
  return true;
}

export async function hidePlace(placeId: number): Promise<string | null> {
  const { rows } = await pool.query('UPDATE places SET hidden = TRUE WHERE id = $1 RETURNING name', [placeId]);
  return rows[0]?.name ?? null;
}

export async function unhidePlace(placeId: number): Promise<string | null> {
  const { rows } = await pool.query('UPDATE places SET hidden = FALSE WHERE id = $1 RETURNING name', [placeId]);
  return rows[0]?.name ?? null;
}

// ── 카카오 수집 ─────────────────────────────────────

export interface KakaoPlace {
  kakaoPlaceId: string;
  name: string;
  categoryPath: string | null;
  address: string | null;
  roadAddress: string | null;
  phone: string | null;
  kakaoUrl: string | null;
  lat: number;
  lng: number;
  distanceM: number | null;
}

// 수집 결과 반영. 새로 들어온 곳만 first_seen_at이 지금으로 찍힌다.
export async function upsertCollected(p: KakaoPlace): Promise<boolean> {
  const { rows } = await pool.query(`
    INSERT INTO places (kakao_place_id, name, category_path, address, road_address, phone, kakao_url,
                        lat, lng, distance_m, source)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'collect')
    ON CONFLICT (kakao_place_id) DO UPDATE SET
      name = EXCLUDED.name, category_path = EXCLUDED.category_path, address = EXCLUDED.address,
      road_address = EXCLUDED.road_address, phone = EXCLUDED.phone, kakao_url = EXCLUDED.kakao_url,
      lat = EXCLUDED.lat, lng = EXCLUDED.lng, distance_m = EXCLUDED.distance_m
    RETURNING (xmax = 0) AS inserted`,
    [p.kakaoPlaceId, p.name, p.categoryPath, p.address, p.roadAddress, p.phone, p.kakaoUrl,
      p.lat, p.lng, p.distanceM]);
  return rows[0].inserted;
}

// ── 구글 평점 ──────────────────────────────────────

export interface GoogleTodo {
  id: number; name: string; categoryPath: string | null; kindOverride: string | null;
  lat: number; lng: number; googlePlaceId: string | null; distanceM: number | null;
}

// 아직 구글과 짝짓지 않은 곳 (실패한 곳은 90일 뒤 다시 시도)
export async function placesNeedingGoogleMatch(): Promise<GoogleTodo[]> {
  const { rows } = await pool.query(`
    SELECT id, name, category_path, kind_override, lat, lng, google_place_id, distance_m FROM places
    WHERE NOT hidden AND google_place_id IS NULL AND lat IS NOT NULL
      AND (google_match_failed_at IS NULL OR google_match_failed_at < now() - interval '90 days')
    ORDER BY distance_m NULLS LAST`);
  return rows.map(toTodo);
}

// 평점이 25일 넘게 묵은 곳 (구글 약관: 30일 안에 갱신)
export async function placesNeedingGoogleRefresh(): Promise<GoogleTodo[]> {
  const { rows } = await pool.query(`
    SELECT id, name, category_path, kind_override, lat, lng, google_place_id, distance_m FROM places
    WHERE NOT hidden AND google_place_id IS NOT NULL
      AND (google_checked_at IS NULL OR google_checked_at < now() - interval '25 days')
    ORDER BY google_checked_at NULLS FIRST`);
  return rows.map(toTodo);
}

function toTodo(r: any): GoogleTodo {
  return { id: r.id, name: r.name, categoryPath: r.category_path, kindOverride: r.kind_override,
    lat: r.lat, lng: r.lng, googlePlaceId: r.google_place_id, distanceM: r.distance_m };
}

export async function setGoogleMatch(id: number, googlePlaceId: string | null): Promise<void> {
  if (googlePlaceId) {
    await pool.query('UPDATE places SET google_place_id = $2, google_match_failed_at = NULL WHERE id = $1',
      [id, googlePlaceId]);
  } else {
    await pool.query('UPDATE places SET google_match_failed_at = now() WHERE id = $1', [id]);
  }
}

export async function setGoogleRating(id: number, rating: number | null, count: number | null): Promise<void> {
  await pool.query(
    `UPDATE places SET google_rating = $2, google_rating_count = $3, google_checked_at = now() WHERE id = $1`,
    [id, rating, count]);
}

// 30일 넘게 갱신 못 한 평점은 지운다 (구글 약관)
export async function expireStaleGoogleRatings(): Promise<void> {
  await pool.query(`
    UPDATE places SET google_rating = NULL, google_rating_count = NULL
    WHERE google_checked_at < now() - interval '30 days' AND google_rating IS NOT NULL`);
}
