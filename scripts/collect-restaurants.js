// 카카오 로컬 API로 회사 반경 1km 내 음식점 수집 → DB 저장
require('dotenv').config();

const kakao = require('../src/services/kakao');
const db = require('../src/db/queries');

async function main() {
  if (!process.env.KAKAO_REST_API_KEY) {
    console.error('❌ KAKAO_REST_API_KEY가 .env에 설정돼 있지 않습니다.');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL이 .env에 설정돼 있지 않습니다.');
    process.exit(1);
  }

  console.log('🔍 카카오 로컬 API로 망원동 회사 반경 500m 음식점 수집 중...');
  const docs = await kakao.collectAllRestaurants(500);
  console.log(`📦 ${docs.length}개 식당 수신`);

  // kakao_place_id 기준 중복 제거
  const seen = new Set();
  const unique = docs.filter(d => {
    if (seen.has(d.id)) return false;
    seen.add(d.id);
    return true;
  });
  console.log(`✨ 중복 제거 후 ${unique.length}개`);

  let inserted = 0;
  for (const doc of unique) {
    const restaurant = kakao.mapKakaoToRestaurant(doc);
    try {
      await db.upsertRestaurant(restaurant);
      inserted += 1;
    } catch (e) {
      console.error(`⚠️ ${restaurant.name} 저장 실패:`, e.message);
    }
  }
  console.log(`✅ ${inserted}개 식당이 DB에 저장됐습니다.`);
  await db.pool.end();
}

main().catch((e) => {
  console.error('💥 수집 실패:', e);
  process.exit(1);
});
