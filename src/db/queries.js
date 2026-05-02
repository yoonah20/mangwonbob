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

// 추천 식당 (탐험 + 미탐험 섞어서)
async function listRecommendedRestaurants(category = null, limit = 3) {
  const params = [];
  let where = `WHERE COALESCE(r.hidden, FALSE) = FALSE`;
  if (category) {
    params.push(`%${category}%`);
    where += ` AND r.category ILIKE $${params.length}`;
  }
  params.push(limit);
  const { rows } = await q(
    `SELECT r.*,
       EXISTS (SELECT 1 FROM visits v WHERE v.restaurant_id = r.id) AS discovered
     FROM restaurants r
     ${where}
     ORDER BY RANDOM() LIMIT $${params.length}`,
    params
  );
  return rows;
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

async function countUserVisits(restaurantId, userId) {
  const { rows } = await q(
    `SELECT COUNT(*)::int AS c FROM visits WHERE restaurant_id = $1 AND slack_user_id = $2`,
    [restaurantId, userId]
  );
  return rows[0].c;
}

// ─── 리뷰 ─────────────────────────────────────────────
async function addReview({ restaurantId, userId, userName, rating, comment, tags }) {
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

async function getRestaurantTags(restaurantId) {
  const { rows } = await q(
    `SELECT DISTINCT UNNEST(tags) AS tag FROM reviews WHERE restaurant_id = $1`,
    [restaurantId]
  );
  return rows.map(r => r.tag);
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
  const meCol = userId
    ? `, EXISTS (SELECT 1 FROM visits v WHERE v.restaurant_id = r.id AND v.slack_user_id = $1) AS visited_by_me`
    : `, FALSE AS visited_by_me`;
  const sql = `SELECT r.*,
       EXISTS (SELECT 1 FROM visits v WHERE v.restaurant_id = r.id) AS discovered,
       (SELECT ROUND(AVG(rating)::numeric, 1) FROM reviews WHERE restaurant_id = r.id) AS avg_rating,
       (SELECT COUNT(*) FROM visits WHERE restaurant_id = r.id)::int AS visit_count
       ${meCol}
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

module.exports = {
  pool,
  q,
  upsertRestaurant,
  findRestaurantByName,
  searchRestaurantsByName,
  getRestaurantById,
  getRestaurantStats,
  listDiscoveredRestaurants,
  listUnknownRestaurants,
  listRecommendedRestaurants,
  listAllRestaurantsWithStatus,
  hideRestaurant,
  addVisit,
  userHasVisited,
  countUserVisits,
  addReview,
  getLatestReview,
  getRestaurantTags,
  getUserStats,
  getUserFirstDiscoveries,
  getUserRegulars,
  getTeamProgress,
  getDiscovererRanking,
  getFirstDiscovererRanking,
  getRegularKing,
};
