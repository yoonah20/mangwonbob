// PostgreSQL 연결 풀 + 쿼리 모음
const { Pool } = require('pg');

// railway.internal은 Railway 컨테이너 내부 전용 — 로컬에서는 PUBLIC URL 사용
const rawUrl = process.env.DATABASE_URL || '';
const connectionString = rawUrl.includes('railway.internal')
  ? (process.env.DATABASE_PUBLIC_URL || rawUrl)
  : rawUrl;

const pool = new Pool({
  connectionString,
  ssl: connectionString.includes('railway') || process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
});

const q = (text, params) => pool.query(text, params);

// ─── 식당 ─────────────────────────────────────────────
async function upsertRestaurant(r) {
  const sql = `
    INSERT INTO restaurants
      (kakao_place_id, name, category, address, road_address, phone, kakao_url,
       distance_from_office, latitude, longitude)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT (kakao_place_id) DO UPDATE SET
      name = EXCLUDED.name,
      category = EXCLUDED.category,
      address = EXCLUDED.address,
      road_address = EXCLUDED.road_address,
      phone = EXCLUDED.phone,
      kakao_url = EXCLUDED.kakao_url,
      distance_from_office = EXCLUDED.distance_from_office
    RETURNING *`;
  const { rows } = await q(sql, [
    r.kakao_place_id, r.name, r.category, r.address, r.road_address,
    r.phone, r.kakao_url, r.distance_from_office, r.latitude, r.longitude,
  ]);
  return rows[0];
}

// 전체 식당 수 (숨김 포함) — 수집 전후 신규 식당 수 계산용
async function countRestaurants() {
  const { rows } = await q(`SELECT COUNT(*)::int AS c FROM restaurants`);
  return rows[0].c;
}

async function findRestaurantByName(name) {
  const { rows } = await q(
    `SELECT * FROM restaurants WHERE name ILIKE $1 ORDER BY distance_from_office ASC LIMIT 1`,
    [`%${name}%`]
  );
  return rows[0];
}

async function searchRestaurantsByName(name, limit = 5) {
  const { rows } = await q(
    `SELECT * FROM restaurants WHERE name ILIKE $1 ORDER BY distance_from_office ASC LIMIT $2`,
    [`%${name}%`, limit]
  );
  return rows;
}

async function getRestaurantById(id) {
  const { rows } = await q(`SELECT * FROM restaurants WHERE id = $1`, [id]);
  return rows[0];
}

// 식당별 집계 정보 (방문수, 리뷰수, 평균별점, 첫발견자)
async function getRestaurantStats(restaurantId) {
  const { rows } = await q(
    `SELECT
       (SELECT COUNT(*) FROM visits WHERE restaurant_id = $1)::int AS visit_count,
       (SELECT COUNT(DISTINCT slack_user_id) FROM visits WHERE restaurant_id = $1)::int AS unique_visitors,
       (SELECT COUNT(*) FROM reviews WHERE restaurant_id = $1)::int AS review_count,
       (SELECT ROUND(AVG(rating)::numeric, 1) FROM reviews WHERE restaurant_id = $1) AS avg_rating,
       (SELECT slack_user_id FROM visits WHERE restaurant_id = $1 AND is_first_discoverer = TRUE LIMIT 1) AS discoverer_id,
       (SELECT slack_user_name FROM visits WHERE restaurant_id = $1 AND is_first_discoverer = TRUE LIMIT 1) AS discoverer_name`,
    [restaurantId]
  );
  return rows[0];
}

// 방문된 적 있는 식당 목록 (DISCOVERED)
async function listDiscoveredRestaurants(category = null, limit = 20) {
  const params = [];
  let where = `WHERE COALESCE(r.hidden, FALSE) = FALSE
    AND EXISTS (SELECT 1 FROM visits v WHERE v.restaurant_id = r.id)`;
  if (category) {
    params.push(`%${category}%`);
    where += ` AND r.category ILIKE $${params.length}`;
  }
  params.push(limit);
  const { rows } = await q(
    `SELECT r.* FROM restaurants r ${where}
     ORDER BY r.distance_from_office ASC LIMIT $${params.length}`,
    params
  );
  return rows;
}

// 미탐험 식당
async function listUnknownRestaurants(category = null, limit = 5) {
  const params = [];
  let where = `WHERE COALESCE(r.hidden, FALSE) = FALSE
    AND NOT EXISTS (SELECT 1 FROM visits v WHERE v.restaurant_id = r.id)`;
  if (category) {
    params.push(`%${category}%`);
    where += ` AND r.category ILIKE $${params.length}`;
  }
  params.push(limit);
  const { rows } = await q(
    `SELECT r.* FROM restaurants r ${where}
     ORDER BY r.distance_from_office ASC LIMIT $${params.length}`,
    params
  );
  return rows;
}

// 추천 식당 — 가중치 점수 기반
// score = 평점 + 인기도(log) + 거리역가중 + 작은 랜덤 노이즈
// 그리고 미탐험을 1자리 이상 항상 포함시켜 발견 동기 유지
async function listRecommendedRestaurants(category = null, limit = 3) {
  const params = [];
  let where = `WHERE COALESCE(r.hidden, FALSE) = FALSE`;
  if (category) {
    params.push(`%${category}%`);
    where += ` AND r.category ILIKE $${params.length}`;
  }

  // 점수 계산 — Postgres에서 한 번에
  const scoreSql = `
    SELECT r.*,
      EXISTS (SELECT 1 FROM visits v WHERE v.restaurant_id = r.id) AS discovered,
      (SELECT COUNT(*) FROM visits WHERE restaurant_id = r.id)::int AS visit_count,
      (SELECT ROUND(AVG(rating)::numeric, 2) FROM reviews WHERE restaurant_id = r.id) AS avg_rating,
      (
        COALESCE((SELECT AVG(rating) FROM reviews WHERE restaurant_id = r.id), 3.0)
        + LN(GREATEST((SELECT COUNT(*) FROM visits WHERE restaurant_id = r.id), 1) + 1) * 0.4
        - (COALESCE(r.distance_from_office, 500) / 500.0) * 0.5
        + RANDOM() * 0.6
      ) AS score
    FROM restaurants r
    ${where}
  `;

  // 발견된 곳 중 상위 + 미탐험 중 1곳 — 합쳐서 limit
  const discoveredCount = Math.max(limit - 1, 1);
  const { rows: top } = await q(
    `SELECT * FROM (${scoreSql}) sub
     WHERE discovered = TRUE
     ORDER BY score DESC LIMIT ${discoveredCount}`,
    params
  );
  const { rows: unknown } = await q(
    `SELECT * FROM (${scoreSql}) sub
     WHERE discovered = FALSE
     ORDER BY score DESC LIMIT ${limit - top.length}`,
    params
  );
  return [...top, ...unknown].slice(0, limit);
}

// ─── 방문 ─────────────────────────────────────────────
async function addVisit(restaurantId, userId, userName) {
  // 첫 방문자(첫 발견자) 여부 확인
  const { rows: prev } = await q(
    `SELECT 1 FROM visits WHERE restaurant_id = $1 LIMIT 1`,
    [restaurantId]
  );
  const isFirst = prev.length === 0;
  const { rows } = await q(
    `INSERT INTO visits (restaurant_id, slack_user_id, slack_user_name, is_first_discoverer)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [restaurantId, userId, userName, isFirst]
  );
  return { visit: rows[0], isFirstDiscoverer: isFirst };
}

async function userHasVisited(restaurantId, userId) {
  const { rows } = await q(
    `SELECT 1 FROM visits WHERE restaurant_id = $1 AND slack_user_id = $2 LIMIT 1`,
    [restaurantId, userId]
  );
  return rows.length > 0;
}

// 체크인 취소 — 본인의 가장 최근 방문 기록 1건 삭제
// 첫 발견자 이전이면 다음 방문자에게 발견자 플래그를 넘김
async function cancelLatestVisit(restaurantId, userId) {
  const { rows } = await q(
    `SELECT id, is_first_discoverer FROM visits
     WHERE restaurant_id = $1 AND slack_user_id = $2
     ORDER BY visited_at DESC LIMIT 1`,
    [restaurantId, userId]
  );
  if (!rows.length) return { canceled: false };
  const visit = rows[0];
  await q(`DELETE FROM visits WHERE id = $1`, [visit.id]);

  // 첫 발견자 플래그 이전
  if (visit.is_first_discoverer) {
    const { rows: next } = await q(
      `SELECT id FROM visits WHERE restaurant_id = $1 ORDER BY visited_at ASC LIMIT 1`,
      [restaurantId]
    );
    if (next.length) {
      await q(`UPDATE visits SET is_first_discoverer = TRUE WHERE id = $1`, [next[0].id]);
    }
  }
  return { canceled: true };
}

async function countUserVisits(restaurantId, userId) {
  const { rows } = await q(
    `SELECT COUNT(*)::int AS c FROM visits WHERE restaurant_id = $1 AND slack_user_id = $2`,
    [restaurantId, userId]
  );
  return rows[0].c;
}

// ─── 리뷰 ─────────────────────────────────────────────
// 한 식당당 한 사람 한 리뷰 — 있으면 업데이트, 없으면 새로 작성
async function addReview({ restaurantId, userId, userName, rating, comment, tags }) {
  const existing = await q(
    `SELECT id FROM reviews WHERE restaurant_id = $1 AND slack_user_id = $2 LIMIT 1`,
    [restaurantId, userId]
  );
  if (existing.rows.length) {
    const { rows } = await q(
      `UPDATE reviews SET rating = $1, comment = $2, tags = $3,
         slack_user_name = $4, created_at = NOW()
       WHERE id = $5 RETURNING *`,
      [rating, comment, tags || [], userName, existing.rows[0].id]
    );
    return rows[0];
  }
  const { rows } = await q(
    `INSERT INTO reviews (restaurant_id, slack_user_id, slack_user_name, rating, comment, tags)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [restaurantId, userId, userName, rating, comment, tags || []]
  );
  return rows[0];
}

async function getLatestReview(restaurantId) {
  const { rows } = await q(
    `SELECT * FROM reviews WHERE restaurant_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [restaurantId]
  );
  return rows[0];
}

async function listReviews(restaurantId) {
  const { rows } = await q(
    `SELECT id, slack_user_id, slack_user_name, rating, comment, tags, created_at
     FROM reviews WHERE restaurant_id = $1
     ORDER BY created_at DESC`,
    [restaurantId]
  );
  return rows;
}

async function getRestaurantTags(restaurantId) {
  const { rows } = await q(
    `SELECT DISTINCT UNNEST(tags) AS tag FROM reviews WHERE restaurant_id = $1`,
    [restaurantId]
  );
  return rows.map(r => r.tag);
}

// ─── 활동 피드 ────────────────────────────────────────
// visits + reviews + meetups를 시간순 통합
async function getRecentActivity(limit = 20) {
  const sql = `
    WITH activity AS (
      SELECT 'visit' AS kind,
        v.slack_user_id AS user_id, v.slack_user_name AS user_name,
        v.restaurant_id, v.is_first_discoverer AS first_discovery,
        NULL::int AS rating, NULL::text AS comment, v.visited_at AS at
      FROM visits v
      UNION ALL
      SELECT 'review' AS kind,
        r.slack_user_id, r.slack_user_name,
        r.restaurant_id, FALSE,
        r.rating, r.comment, r.created_at
      FROM reviews r
      UNION ALL
      SELECT 'meetup' AS kind,
        m.organizer_id, m.organizer_name,
        m.restaurant_id, FALSE,
        NULL::int, m.note, m.created_at
      FROM meetups m
    )
    SELECT a.*, r.name AS restaurant_name,
      r.category AS restaurant_category, r.latitude, r.longitude
    FROM activity a
    JOIN restaurants r ON r.id = a.restaurant_id
    WHERE COALESCE(r.hidden, FALSE) = FALSE
    ORDER BY a.at DESC
    LIMIT $1`;
  const { rows } = await q(sql, [limit]);
  return rows;
}

// ─── 점심 모집 ────────────────────────────────────────
async function createMeetup({ restaurantId, organizerId, organizerName, meetAt, note, channelId }) {
  const { rows } = await q(
    `INSERT INTO meetups (restaurant_id, organizer_id, organizer_name, meet_at, note, channel_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [restaurantId, organizerId, organizerName, meetAt, note || null, channelId || null]
  );
  return rows[0];
}

async function setMeetupMessageTs(meetupId, ts) {
  await q(`UPDATE meetups SET message_ts = $1 WHERE id = $2`, [ts, meetupId]);
}

async function getMeetup(id) {
  const { rows } = await q(`SELECT * FROM meetups WHERE id = $1`, [id]);
  return rows[0];
}

async function joinMeetup(meetupId, userId, userName) {
  await q(
    `INSERT INTO meetup_participants (meetup_id, slack_user_id, slack_user_name)
     VALUES ($1, $2, $3) ON CONFLICT (meetup_id, slack_user_id) DO NOTHING`,
    [meetupId, userId, userName]
  );
}

async function leaveMeetup(meetupId, userId) {
  await q(
    `DELETE FROM meetup_participants WHERE meetup_id = $1 AND slack_user_id = $2`,
    [meetupId, userId]
  );
}

async function listMeetupParticipants(meetupId) {
  const { rows } = await q(
    `SELECT slack_user_id, slack_user_name, joined_at FROM meetup_participants
     WHERE meetup_id = $1 ORDER BY joined_at ASC`,
    [meetupId]
  );
  return rows;
}

async function closeMeetup(meetupId) {
  await q(`UPDATE meetups SET status = 'closed' WHERE id = $1`, [meetupId]);
}

// 식당별 활성 모집 (현재 시각 이후, status = open) — 지도용
async function listActiveMeetupsByRestaurant() {
  const { rows } = await q(
    `SELECT m.id, m.restaurant_id, m.organizer_id, m.organizer_name,
       m.meet_at, m.note, m.status,
       (SELECT COUNT(*) FROM meetup_participants WHERE meetup_id = m.id)::int AS participant_count,
       (SELECT array_agg(slack_user_id) FROM meetup_participants WHERE meetup_id = m.id) AS participant_ids
     FROM meetups m
     WHERE m.status = 'open' AND m.meet_at > NOW()
     ORDER BY m.meet_at ASC`
  );
  return rows;
}

// ─── 개인 통계 ────────────────────────────────────────
async function getUserStats(userId) {
  const { rows } = await q(
    `SELECT
       (SELECT COUNT(DISTINCT restaurant_id) FROM visits WHERE slack_user_id = $1)::int AS discovered_count,
       (SELECT COUNT(*) FROM visits WHERE slack_user_id = $1 AND is_first_discoverer = TRUE)::int AS first_count,
       (SELECT COUNT(*) FROM restaurants WHERE COALESCE(hidden, FALSE) = FALSE)::int AS total_restaurants`,
    [userId]
  );
  return rows[0];
}

async function getUserFirstDiscoveries(userId) {
  const { rows } = await q(
    `SELECT r.* FROM restaurants r
     JOIN visits v ON v.restaurant_id = r.id
     WHERE v.slack_user_id = $1 AND v.is_first_discoverer = TRUE
     ORDER BY v.visited_at DESC`,
    [userId]
  );
  return rows;
}

async function getUserRegulars(userId, minVisits = 3) {
  const { rows } = await q(
    `SELECT r.*, COUNT(v.id)::int AS visit_count
     FROM restaurants r
     JOIN visits v ON v.restaurant_id = r.id
     WHERE v.slack_user_id = $1
     GROUP BY r.id
     HAVING COUNT(v.id) >= $2
     ORDER BY visit_count DESC`,
    [userId, minVisits]
  );
  return rows;
}

// ─── 팀 랭킹 ──────────────────────────────────────────
async function getTeamProgress() {
  const { rows } = await q(
    `SELECT
       (SELECT COUNT(*) FROM restaurants WHERE COALESCE(hidden, FALSE) = FALSE)::int AS total,
       (SELECT COUNT(DISTINCT restaurant_id) FROM visits)::int AS discovered`
  );
  return rows[0];
}

async function getDiscovererRanking(limit = 10) {
  const { rows } = await q(
    `SELECT slack_user_id, slack_user_name,
       COUNT(DISTINCT restaurant_id)::int AS discovered_count
     FROM visits
     GROUP BY slack_user_id, slack_user_name
     ORDER BY discovered_count DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

async function getFirstDiscovererRanking(limit = 5) {
  const { rows } = await q(
    `SELECT slack_user_id, slack_user_name, COUNT(*)::int AS first_count
     FROM visits WHERE is_first_discoverer = TRUE
     GROUP BY slack_user_id, slack_user_name
     ORDER BY first_count DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

async function getRegularKing(limit = 5) {
  const { rows } = await q(
    `SELECT v.slack_user_id, v.slack_user_name, r.name AS restaurant_name,
       COUNT(*)::int AS visit_count
     FROM visits v JOIN restaurants r ON r.id = v.restaurant_id
     GROUP BY v.slack_user_id, v.slack_user_name, r.name
     HAVING COUNT(*) >= 3
     ORDER BY visit_count DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

// 모든 식당 + 상태 (지도 뷰용)
async function listAllRestaurantsWithStatus(userId = null) {
  const meCols = userId
    ? `,
       EXISTS (SELECT 1 FROM visits v WHERE v.restaurant_id = r.id AND v.slack_user_id = $1) AS visited_by_me,
       (SELECT COUNT(*) FROM visits WHERE restaurant_id = r.id AND slack_user_id = $1)::int AS my_visit_count,
       EXISTS (SELECT 1 FROM favorites f WHERE f.restaurant_id = r.id AND f.slack_user_id = $1) AS is_favorite,
       (SELECT json_build_object('rating', rating, 'comment', comment, 'tags', tags, 'created_at', created_at)
        FROM reviews WHERE restaurant_id = r.id AND slack_user_id = $1 LIMIT 1) AS my_review`
    : `, FALSE AS visited_by_me, 0 AS my_visit_count, FALSE AS is_favorite, NULL AS my_review`;
  const sampleReviewWhere = userId
    ? `AND comment IS NOT NULL AND comment != '' AND slack_user_id != $1`
    : `AND comment IS NOT NULL AND comment != ''`;
  const sql = `SELECT r.*,
       EXISTS (SELECT 1 FROM visits v WHERE v.restaurant_id = r.id) AS discovered,
       (SELECT ROUND(AVG(rating)::numeric, 1) FROM reviews WHERE restaurant_id = r.id) AS avg_rating,
       (SELECT COUNT(*) FROM visits WHERE restaurant_id = r.id)::int AS visit_count,
       (SELECT COUNT(*) FROM reviews WHERE restaurant_id = r.id)::int AS review_count,
       (SELECT json_build_object('rating', rating, 'comment', comment, 'tags', tags,
         'user_name', slack_user_name)
        FROM reviews
        WHERE restaurant_id = r.id ${sampleReviewWhere}
        ORDER BY RANDOM() LIMIT 1) AS sample_review
       ${meCols}
     FROM restaurants r
     WHERE COALESCE(r.hidden, FALSE) = FALSE
     ORDER BY r.distance_from_office ASC`;
  const { rows } = userId ? await q(sql, [userId]) : await q(sql);
  return rows;
}

// 식당 숨김 처리
async function hideRestaurant(id) {
  await q(`UPDATE restaurants SET hidden = TRUE WHERE id = $1`, [id]);
}

async function unhideRestaurant(id) {
  await q(`UPDATE restaurants SET hidden = FALSE WHERE id = $1`, [id]);
}

// 퇴출된 식당 목록
async function listHiddenRestaurants() {
  const { rows } = await q(
    `SELECT * FROM restaurants WHERE hidden = TRUE ORDER BY name ASC`
  );
  return rows;
}

// 즐겨찾기
async function toggleFavorite(userId, restaurantId) {
  const { rows } = await q(
    `SELECT id FROM favorites WHERE slack_user_id = $1 AND restaurant_id = $2`,
    [userId, restaurantId]
  );
  if (rows.length) {
    await q(`DELETE FROM favorites WHERE id = $1`, [rows[0].id]);
    return { favorited: false };
  }
  await q(
    `INSERT INTO favorites (slack_user_id, restaurant_id) VALUES ($1, $2)`,
    [userId, restaurantId]
  );
  return { favorited: true };
}

module.exports = {
  pool,
  q,
  upsertRestaurant,
  countRestaurants,
  findRestaurantByName,
  searchRestaurantsByName,
  getRestaurantById,
  getRestaurantStats,
  listDiscoveredRestaurants,
  listUnknownRestaurants,
  listRecommendedRestaurants,
  listAllRestaurantsWithStatus,
  hideRestaurant,
  unhideRestaurant,
  listHiddenRestaurants,
  toggleFavorite,
  addVisit,
  userHasVisited,
  cancelLatestVisit,
  countUserVisits,
  addReview,
  getLatestReview,
  listReviews,
  getRestaurantTags,
  createMeetup,
  setMeetupMessageTs,
  getMeetup,
  joinMeetup,
  leaveMeetup,
  listMeetupParticipants,
  closeMeetup,
  listActiveMeetupsByRestaurant,
  getRecentActivity,
  getUserStats,
  getUserFirstDiscoveries,
  getUserRegulars,
  getTeamProgress,
  getDiscovererRanking,
  getFirstDiscovererRanking,
  getRegularKing,
};
