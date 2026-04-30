// 탐험 순위 집계
const db = require('../db/queries');

// 개인 탐험 현황
async function getUserExploration(userId) {
  const stats = await db.getUserStats(userId);
  const firstDiscoveries = await db.getUserFirstDiscoveries(userId);
  const regulars = await db.getUserRegulars(userId, 3);
  const ranking = await db.getDiscovererRanking(100);
  const myRank = ranking.findIndex(r => r.slack_user_id === userId) + 1;

  return {
    discoveredCount: stats.discovered_count,
    totalRestaurants: stats.total_restaurants,
    firstCount: stats.first_count,
    firstDiscoveries,
    regulars,
    rank: myRank || ranking.length + 1,
    totalUsers: ranking.length,
  };
}

// 팀 전체 지도 현황
async function getTeamMap() {
  const progress = await db.getTeamProgress();
  const explorerKing = await db.getDiscovererRanking(1);
  const firstKing = await db.getFirstDiscovererRanking(1);
  const regularKing = await db.getRegularKing(1);
  return {
    total: progress.total,
    discovered: progress.discovered,
    explorerKing: explorerKing[0] || null,
    firstKing: firstKing[0] || null,
    regularKing: regularKing[0] || null,
  };
}

module.exports = {
  getUserExploration,
  getTeamMap,
};
