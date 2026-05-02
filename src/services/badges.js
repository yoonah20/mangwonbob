// 도전 과제 / 뱃지 — 사용자 활동 데이터 기반 자동 계산
const db = require('../db/queries');

// 카테고리 버킷 (지도 클라이언트와 동일한 매핑)
function categoryBucket(cat) {
  cat = cat || '';
  if (/한식|국밥|국수|찌개|찜|족발|보쌈|쌈/.test(cat)) return '한식';
  if (/일식|초밥|스시|라멘|돈까스|우동|텐동/.test(cat)) return '일식';
  if (/중식|짜장|마라/.test(cat)) return '중식';
  if (/양식|파스타|피자|버거|스테이크|이탈리|프렌치/.test(cat)) return '양식';
  if (/카페|커피|디저트|베이커리|빵|티/.test(cat)) return '카페';
  if (/술집|호프|바|이자카야|와인|맥주/.test(cat)) return '술집';
  if (/분식|떡볶이|김밥/.test(cat)) return '분식';
  if (/치킨/.test(cat)) return '치킨';
  if (/고기|구이|곱창/.test(cat)) return '고기';
  return '기타';
}

const CAT_EMOJI = {
  한식: '🍚', 일식: '🍣', 중식: '🥢', 양식: '🍕', 카페: '☕',
  술집: '🍺', 분식: '🌶️', 치킨: '🍗', 고기: '🥩',
};

// 사용자 뱃지 계산 (DB 1번 쿼리)
async function getUserBadges(userId) {
  // 사용자별 방문 식당 + 카테고리 + 첫 발견 + 리뷰 수
  const { rows } = await db.q(
    `SELECT
       (SELECT COUNT(DISTINCT v.restaurant_id) FROM visits v
          WHERE v.slack_user_id = $1)::int AS discovered,
       (SELECT COUNT(*) FROM visits v WHERE v.slack_user_id = $1
          AND v.is_first_discoverer = TRUE)::int AS firsts,
       (SELECT COUNT(*) FROM reviews WHERE slack_user_id = $1)::int AS reviews,
       (SELECT COUNT(*) FROM (
          SELECT restaurant_id FROM visits WHERE slack_user_id = $1
          GROUP BY restaurant_id HAVING COUNT(*) >= 3
        ) sub)::int AS regulars`,
    [userId]
  );
  const stats = rows[0];

  // 카테고리별 방문 식당 수
  const { rows: catRows } = await db.q(
    `SELECT r.category, COUNT(DISTINCT r.id)::int AS n
     FROM restaurants r JOIN visits v ON v.restaurant_id = r.id
     WHERE v.slack_user_id = $1 AND COALESCE(r.hidden, FALSE) = FALSE
     GROUP BY r.category`,
    [userId]
  );
  const catCounts = {};
  for (const r of catRows) {
    const b = categoryBucket(r.category);
    catCounts[b] = (catCounts[b] || 0) + r.n;
  }

  const badges = [];

  // 탐험 등급
  if (stats.discovered >= 30) badges.push({ emoji: '🗺️', label: '망원동 마스터', sub: `${stats.discovered}곳 탐험` });
  else if (stats.discovered >= 15) badges.push({ emoji: '🥾', label: '베테랑 탐험가', sub: `${stats.discovered}곳 탐험` });
  else if (stats.discovered >= 5) badges.push({ emoji: '🌱', label: '새내기 탐험가', sub: `${stats.discovered}곳 탐험` });
  else if (stats.discovered >= 1) badges.push({ emoji: '🐣', label: '첫 발걸음', sub: `${stats.discovered}곳 탐험` });

  // 첫 발견자
  if (stats.firsts >= 5) badges.push({ emoji: '🚩', label: '개척자', sub: `${stats.firsts}곳 첫 발견` });
  else if (stats.firsts >= 1) badges.push({ emoji: '🏴', label: '첫 발견자', sub: `${stats.firsts}곳` });

  // 단골왕
  if (stats.regulars >= 5) badges.push({ emoji: '👑', label: '단골왕', sub: `${stats.regulars}곳 단골` });
  else if (stats.regulars >= 1) badges.push({ emoji: '🥢', label: '단골', sub: `${stats.regulars}곳` });

  // 리뷰어
  if (stats.reviews >= 10) badges.push({ emoji: '🖋️', label: '리뷰 마스터', sub: `${stats.reviews}건` });
  else if (stats.reviews >= 3) badges.push({ emoji: '✍️', label: '리뷰어', sub: `${stats.reviews}건` });

  // 카테고리 마스터 (각 카테고리 5곳+)
  for (const [cat, n] of Object.entries(catCounts)) {
    if (n >= 5 && CAT_EMOJI[cat]) {
      badges.push({ emoji: CAT_EMOJI[cat], label: `${cat} 마스터`, sub: `${n}곳` });
    }
  }

  return { stats, badges };
}

module.exports = { getUserBadges };
