// 월 1회 자동 식당 수집 스케줄러.
// 외부 의존성(node-cron 등) 없이 1시간마다 시각을 확인해
// "매월 RUN_DAY일 RUN_HOUR시(서버 로컬시각) 이후, 한 달에 한 번"만 수집을 실행한다.
const { collectRestaurants } = require('./collect');

const RUN_DAY = 1;   // 매월 1일
const RUN_HOUR = 4;  // 새벽 4시 이후 (저트래픽 시간대)
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1시간마다 확인

// 이미 수집한 달을 기억해 재시작·중복 실행을 방지 ('YYYY-M')
let lastRunKey = null;
const monthKey = (d) => `${d.getFullYear()}-${d.getMonth()}`;

// onDone(result|error) — 수집 완료/실패 시 알림 콜백 (선택)
function shouldRun(now) {
  if (lastRunKey === monthKey(now)) return false;
  // 실행 예정 시각(1일 4시)이 지났는지. 1일에 서버가 꺼져 있었으면 이후 날에 자동 보충.
  return now.getDate() >= RUN_DAY && now.getHours() >= RUN_HOUR;
}

async function tick(onDone) {
  const now = new Date();
  if (!shouldRun(now)) return;
  lastRunKey = monthKey(now); // 실행 전에 먼저 표시해 중복 방지
  try {
    console.log('🔄 [자동] 월간 식당 수집 시작');
    const result = await collectRestaurants({ log: (m) => console.log('[자동수집]', m) });
    console.log('✅ [자동] 월간 식당 수집 완료:', JSON.stringify(result));
    if (onDone) await onDone(null, result);
  } catch (e) {
    console.error('💥 [자동] 월간 식당 수집 실패:', e.message);
    if (onDone) await onDone(e, null);
  }
}

// onDone(err, result) — 자동 수집이 끝날 때마다 호출 (예: 슬랙 채널 공지)
function startMonthlyCollect(onDone) {
  if (process.env.DISABLE_AUTO_COLLECT === '1') {
    console.log('⏸️ 월간 자동 수집 비활성화됨 (DISABLE_AUTO_COLLECT=1)');
    return;
  }
  // 시작 시점의 이번 달은 "이미 처리됨"으로 간주 — 잦은 재배포 때마다
  // 수집이 돌지 않도록 하고, 첫 자동 실행은 다음 달 1일부터.
  lastRunKey = monthKey(new Date());
  console.log(`🗓️ 월간 자동 수집 스케줄러 시작 — 매월 ${RUN_DAY}일 ${RUN_HOUR}시(서버시각) 이후 실행`);
  const timer = setInterval(() => tick(onDone), CHECK_INTERVAL_MS);
  if (timer.unref) timer.unref(); // 스케줄러가 프로세스 종료를 막지 않도록
}

module.exports = { startMonthlyCollect, shouldRun, _setLastRunKey: (k) => { lastRunKey = k; } };
