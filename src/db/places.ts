import { pool } from './pool.js';
import type { PlaceInput, Pick } from '../domain/recommend.js';
import { kindOf } from '../domain/kinds.js';

// 추천에 필요한 모든 곳 + 팀 기록을 한 번에 읽는다. 1천 곳 남짓이라 통째로 읽어도 가볍다.
export async function loadPlacesForRecommend(): Promise<PlaceInput[]> {
  const { rows } = await pool.query(`
    SELECT p.id, p.name, p.category_path, p.kind_override, p.distance_m, p.first_seen_at,
           p.source, p.kakao_url,
           COALESCE(r.ups, 0)::int   AS ups,
           COALESCE(r.mehs, 0)::int  AS mehs,
           COALESCE(r.downs, 0)::int AS downs,
           COALESCE(v.n, 0)::int     AS visits,
           v.last_at,
           r.best_comment,
           COALESCE(w.users, '{}')   AS wished_by
    FROM places p
    LEFT JOIN (
      SELECT place_id,
             COUNT(*) FILTER (WHERE verdict = 1)  AS ups,
             COUNT(*) FILTER (WHERE verdict = 0)  AS mehs,
             COUNT(*) FILTER (WHERE verdict = -1) AS downs,
             (ARRAY_AGG(comment ORDER BY verdict DESC, created_at DESC)
                FILTER (WHERE comment IS NOT NULL AND comment <> '' AND verdict = 1))[1] AS best_comment
      FROM ratings GROUP BY place_id
    ) r ON r.place_id = p.id
    LEFT JOIN (SELECT place_id, COUNT(*) AS n, MAX(visited_at) AS last_at FROM visits GROUP BY place_id) v
      ON v.place_id = p.id
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
    ups: r.ups,
    mehs: r.mehs,
    downs: r.downs,
    visits: r.visits,
    lastVisitedAt: r.last_at,
    bestComment: r.best_comment,
    wishedBy: r.wished_by,
  }));
}

export async function getDailyPicks(day: string): Promise<Pick[]> {
  const { rows } = await pool.query(`
    SELECT d.place_id, d.reason, d.verified, p.name, p.category_path, p.kind_override,
           p.distance_m, p.kakao_url
    FROM daily_picks d JOIN places p ON p.id = d.place_id
    WHERE d.day = $1 AND NOT p.hidden
    ORDER BY d.slot`, [day]);
  return rows.map(r => ({
    placeId: r.place_id,
    name: r.name,
    kind: kindOf(r.category_path, r.kind_override),
    distanceM: r.distance_m,
    kakaoUrl: r.kakao_url,
    verified: r.verified,
    reason: r.reason,
  }));
}

// 동시에 두 명이 처음 부르면 먼저 저장한 쪽이 이긴다 (ON CONFLICT DO NOTHING)
export async function saveDailyPicks(day: string, picks: Pick[]): Promise<void> {
  for (const [slot, p] of picks.entries()) {
    await pool.query(
      `INSERT INTO daily_picks (day, slot, place_id, reason, verified) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [day, slot, p.placeId, p.reason, p.verified]);
  }
}

export async function recentlyPickedIds(sinceDay: string, beforeDay: string): Promise<Set<number>> {
  const { rows } = await pool.query(
    'SELECT DISTINCT place_id FROM daily_picks WHERE day >= $1 AND day < $2', [sinceDay, beforeDay]);
  return new Set(rows.map(r => r.place_id));
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
