// 리뷰/방문 기록 처리
const db = require('../db/queries');

// 방문 등록 — 첫 발견자 여부 함께 반환
async function recordVisit(restaurantId, userId, userName) {
  const { visit, isFirstDiscoverer } = await db.addVisit(restaurantId, userId, userName);
  const userVisitCount = await db.countUserVisits(restaurantId, userId);
  return {
    visit,
    isFirstDiscoverer,
    userVisitCount,
    isRegular: userVisitCount >= 3,
  };
}

// 리뷰 등록
async function recordReview({ restaurantId, userId, userName, rating, comment, tags }) {
  return db.addReview({ restaurantId, userId, userName, rating, comment, tags });
}

module.exports = {
  recordVisit,
  recordReview,
};
