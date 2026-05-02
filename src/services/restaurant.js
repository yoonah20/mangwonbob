// 식당 조회/상태 관리
const db = require('../db/queries');

// 식당 1곳 + 상태 정보 조립
async function getRestaurantWithStatus(id) {
  const restaurant = await db.getRestaurantById(id);
  if (!restaurant) return null;
  const stats = await db.getRestaurantStats(id);
  const tags = await db.getRestaurantTags(id);
  const latestReview = await db.getLatestReview(id);
  return {
    ...restaurant,
    discovered: stats.visit_count > 0,
    visitCount: stats.visit_count,
    uniqueVisitors: stats.unique_visitors,
    reviewCount: stats.review_count,
    avgRating: stats.avg_rating ? Number(stats.avg_rating) : null,
    discovererId: stats.discoverer_id,
    discovererName: stats.discoverer_name,
    tags,
    latestReview,
  };
}

// 이름으로 식당 찾기 (부분 일치)
async function findByName(name) {
  const r = await db.findRestaurantByName(name);
  if (!r) return null;
  return getRestaurantWithStatus(r.id);
}

// 추천 목록 (탐험/미탐험 섞어서, 카테고리 필터 가능)
async function getRecommendations(category = null, limit = 3) {
  const list = await db.listRecommendedRestaurants(category, limit);
  return Promise.all(list.map(r => getRestaurantWithStatus(r.id)));
}

// 미탐험 식당 추천
async function getUnvisitedPicks(limit = 3) {
  const list = await db.listUnknownRestaurants(null, limit);
  return Promise.all(list.map(r => getRestaurantWithStatus(r.id)));
}

// 인기 식당 추천 (방문 횟수 많은 순)
async function getPopularPicks(limit = 3) {
  const list = await db.listDiscoveredRestaurants(null, 50);
  // 방문수 추가 후 정렬, 상위 N
  const enriched = await Promise.all(list.map(r => getRestaurantWithStatus(r.id)));
  return enriched
    .filter(r => r.visitCount > 0)
    .sort((a, b) => b.visitCount - a.visitCount)
    .slice(0, limit);
}

module.exports = {
  getRestaurantWithStatus,
  findByName,
  getRecommendations,
  getUnvisitedPicks,
  getPopularPicks,
};
