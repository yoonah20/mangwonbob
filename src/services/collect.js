// 카카오 로컬 API로 회사 주변 음식점을 수집해 DB에 저장하는 공용 로직.
// CLI 스크립트(scripts/collect-restaurants.js), 지도의 "대량 수집" 버튼(POST /api/collect),
// 월 1회 자동 스케줄러(services/scheduler.js)가 모두 이 함수를 공유한다.
const kakao = require('./kakao');
const db = require('../db/queries');

let running = false;
let lastResult = null;

const isRunning = () => running;
const getLastResult = () => lastResult;

// options.radius  — 중심점별 수집 반경(m), 기본 500
// options.log     — 진행 로그 콜백 (기본 no-op)
async function collectRestaurants({ radius = 500, log = () => {} } = {}) {
  if (running) throw new Error('이미 수집이 진행 중입니다.');
  if (!process.env.KAKAO_REST_API_KEY) {
    throw new Error('KAKAO_REST_API_KEY가 설정돼 있지 않습니다.');
  }

  running = true;
  const startedAt = new Date();
  try {
    log('🔍 카카오 로컬 API로 망원동 식당 수집 중...');

    // 수집 중심점들 — 회사 + 망원파출소
    const centers = [kakao.OFFICE];
    const police = await kakao.findLocationByKeyword('망원파출소');
    if (police) {
      log(`📍 망원파출소: ${police.name} (${police.address})`);
      centers.push({ x: police.x, y: police.y });
    } else {
      log('⚠️ 망원파출소를 찾지 못했습니다. 회사 기준으로만 수집');
    }

    const docs = await kakao.collectAllRestaurants(radius, centers);
    log(`📦 ${docs.length}개 식당 수신 (중심점 ${centers.length}개, 각 ${radius}m 반경)`);

    // kakao_place_id 기준 중복 제거
    const seen = new Set();
    const unique = docs.filter(d => {
      if (seen.has(d.id)) return false;
      seen.add(d.id);
      return true;
    });
    log(`✨ 중복 제거 후 ${unique.length}개`);

    // 기존 대비 신규 식당 수 파악 (버튼/알림에서 "N곳 새로 발견" 표시용)
    const before = await db.countRestaurants();

    let inserted = 0;
    let failed = 0;
    for (const doc of unique) {
      const restaurant = kakao.mapKakaoToRestaurant(doc);
      try {
        await db.upsertRestaurant(restaurant);
        inserted += 1;
      } catch (e) {
        failed += 1;
        log(`⚠️ ${restaurant.name} 저장 실패: ${e.message}`);
      }
    }
    const after = await db.countRestaurants();
    const added = Math.max(after - before, 0);

    log(`✅ ${inserted}개 저장 완료 (신규 ${added}곳, 실패 ${failed})`);

    lastResult = {
      received: docs.length,
      unique: unique.length,
      upserted: inserted,
      added,
      failed,
      centers: centers.length,
      radius,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
    };
    return lastResult;
  } finally {
    running = false;
  }
}

module.exports = { collectRestaurants, isRunning, getLastResult };
