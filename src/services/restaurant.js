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

module.exports = {
  getRestaurantWithStatus,
  findByName,
  getRecommendations,
};
