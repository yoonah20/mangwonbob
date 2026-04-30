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

// 지도 뷰 데이터 API
expressApp.get('/api/restaurants', async (_req, res) => {
  try {
    const list = await db.listAllRestaurantsWithStatus();
    res.json(list);
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
