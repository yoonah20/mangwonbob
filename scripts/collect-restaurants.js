// 카카오 로컬 API로 회사 주변 음식점 수집 → DB 저장 (CLI)
// 실제 수집 로직은 src/services/collect.js 에 공용화돼 있다.
require('dotenv').config();

const { collectRestaurants } = require('../src/services/collect');
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

  const result = await collectRestaurants({ log: (m) => console.log(m) });
  console.log(`🎉 완료 — 수신 ${result.received} / 저장 ${result.upserted} / 신규 ${result.added}`);
  await db.pool.end();
}

main().catch((e) => {
  console.error('💥 수집 실패:', e);
  process.exit(1);
});
