// 망원밥 메인 서버 — Slack Bolt (Socket Mode) + Express 헬스체크
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { App, ExpressReceiver } = require('@slack/bolt');
const express = require('express');
const db = require('./db/queries');
const { pool } = db;
const commands = require('./handlers/commands');
const modals = require('./handlers/modals');
const reviewSvc = require('./services/review');

// JSON 바디 파싱 (지도 뷰 API용)
const expressJson = express.json();

// 앱 시작 시 스키마 자동 적용 (IF NOT EXISTS라 멱등)
async function initDb() {
  const sql = fs.readFileSync(path.join(__dirname, 'db/schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('✅ DB 스키마 확인 완료');
}

const useSocketMode = !!process.env.SLACK_APP_TOKEN;

let app;
let expressApp;

if (useSocketMode) {
  // Socket Mode (개발/Railway 권장)
  app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    appToken: process.env.SLACK_APP_TOKEN,
    socketMode: true,
  });
  expressApp = express();
} else {
  // HTTP 모드 (Slack Events URL 직접 노출)
  const receiver = new ExpressReceiver({
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    endpoints: '/slack/events',
  });
  app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    receiver,
  });
  expressApp = receiver.app;
}

// 헬스체크
expressApp.get('/', (_req, res) => res.send('🍚 망원밥 by 몬스테라하우스 — 정상 작동 중'));
expressApp.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// 지도 뷰 — 카카오맵 JS SDK로 식당 마커 표시
expressApp.get('/map', (_req, res) => {
  const key = process.env.KAKAO_JS_API_KEY || '';
  const html = fs.readFileSync(path.join(__dirname, '../public/map.html'), 'utf8')
    .replace('__KAKAO_JS_KEY__', key);
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// 키 주입 확인용 (앞 6자만 노출)
expressApp.get('/debug/map-key', (_req, res) => {
  const key = process.env.KAKAO_JS_API_KEY || '';
  res.json({ key_set: !!key, key_preview: key ? key.slice(0, 6) + '…' : '(없음)' });
});

// 지도 뷰 데이터 API (user 쿼리로 본인 방문 여부 표시)
expressApp.get('/api/restaurants', async (req, res) => {
  try {
    const userId = req.query.user || null;
    const list = await db.listAllRestaurantsWithStatus(userId);
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 지도에서 방문 체크인
expressApp.post('/api/visit', expressJson, async (req, res) => {
  try {
    const { restaurantId, userId, userName } = req.body;
    if (!restaurantId || !userId) return res.status(400).json({ error: 'missing params' });
    const result = await reviewSvc.recordVisit(restaurantId, userId, userName || userId);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 체크인 취소 (가장 최근 방문 1건 삭제)
expressApp.post('/api/visit/cancel', expressJson, async (req, res) => {
  try {
    const { restaurantId, userId } = req.body;
    if (!restaurantId || !userId) return res.status(400).json({ error: 'missing params' });
    const result = await db.cancelLatestVisit(restaurantId, userId);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 지도에서 리뷰 작성 — 체크인한 식당만 가능
expressApp.post('/api/review', expressJson, async (req, res) => {
  try {
    const { restaurantId, userId, userName, rating, comment, tags } = req.body;
    if (!restaurantId || !userId || !rating) return res.status(400).json({ error: 'missing params' });
    const visited = await db.userHasVisited(restaurantId, userId);
    if (!visited) return res.status(403).json({ error: '먼저 체크인해야 리뷰를 쓸 수 있어요' });
    const review = await reviewSvc.recordReview({
      restaurantId, userId, userName: userName || userId,
      rating: parseInt(rating, 10), comment, tags: tags || [],
    });
    res.json(review);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 식당 숨김 (배달 전문점 등)
expressApp.post('/api/hide', expressJson, async (req, res) => {
  try {
    const { restaurantId } = req.body;
    if (!restaurantId) return res.status(400).json({ error: 'missing params' });
    await db.hideRestaurant(restaurantId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 핸들러 등록
commands.register(app);
modals.register(app);

// 전역 에러 처리
app.error(async (err) => {
  console.error('Bolt 글로벌 에러:', err);
});

(async () => {
  await initDb();
  const port = process.env.PORT || 3000;
  if (useSocketMode) {
    await app.start();
    // Socket Mode에서는 Bolt가 포트를 점유하지 않으므로 Express를 별도로 listen
    expressApp.listen(port, () => {
      console.log(`🌐 헬스체크 서버 listening on ${port}`);
    });
  } else {
    await app.start(port);
  }
  console.log(`⚡️ 망원밥 봇 실행 중 (port: ${port}, mode: ${useSocketMode ? 'socket' : 'http'})`);
})();
