// 망원밥 메인 서버 — Slack Bolt (Socket Mode) + Express 헬스체크
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { App, ExpressReceiver } = require('@slack/bolt');
const express = require('express');
const db = require('./db/queries');
const { pool } = db;
const commands = require('./handlers/commands');
const meetups = require('./handlers/meetups');
const reviewSvc = require('./services/review');
const badgesSvc = require('./services/badges');
const kakaoSvc = require('./services/kakao');
const blocks = require('./utils/blocks');

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

// 활성 점심 모집 목록 (지도 InfoWindow용)
expressApp.get('/api/meetups', async (_req, res) => {
  try {
    const list = await db.listActiveMeetupsByRestaurant();
    res.json(list);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 점심 모집 생성 (지도에서)
expressApp.post('/api/meetups', expressJson, async (req, res) => {
  try {
    const { restaurantId, userId, userName, meetAt, note, channelId } = req.body;
    if (!restaurantId || !userId || !meetAt) return res.status(400).json({ error: 'missing params' });
    if (new Date(meetAt) <= new Date()) return res.status(400).json({ error: '미래 시간으로만 모집 가능' });

    const meetup = await db.createMeetup({
      restaurantId, organizerId: userId, organizerName: userName, meetAt, note,
      channelId: channelId || process.env.MEETUP_CHANNEL_ID || null,
    });
    // 주최자 자동 참여
    await db.joinMeetup(meetup.id, userId, userName);

    // Slack 채널 공지
    if (meetup.channel_id) {
      try {
        const restaurant = await db.getRestaurantById(restaurantId);
        const participants = await db.listMeetupParticipants(meetup.id);
        const result = await app.client.chat.postMessage({
          channel: meetup.channel_id,
          text: `🍽️ ${restaurant.name} 점심 모집`,
          blocks: blocks.meetupAnnounceBlocks({ meetup, restaurant, participants }),
        });
        if (result.ts) await db.setMeetupMessageTs(meetup.id, result.ts);
      } catch (e) {
        console.error('점심 모집 슬랙 공지 실패:', e.message);
      }
    }
    res.json(meetup);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 참여 / 나가기 / 마감 (지도에서)
expressApp.post('/api/meetups/:id/join', expressJson, async (req, res) => {
  try {
    const { userId, userName } = req.body;
    if (!userId) return res.status(400).json({ error: 'missing userId' });
    await db.joinMeetup(parseInt(req.params.id, 10), userId, userName);
    await refreshMeetupAnnounce(parseInt(req.params.id, 10));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

expressApp.post('/api/meetups/:id/leave', expressJson, async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'missing userId' });
    await db.leaveMeetup(parseInt(req.params.id, 10), userId);
    await refreshMeetupAnnounce(parseInt(req.params.id, 10));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

expressApp.post('/api/meetups/:id/close', expressJson, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { userId } = req.body;
    const meetup = await db.getMeetup(id);
    if (!meetup) return res.status(404).json({ error: 'not found' });
    if (meetup.organizer_id !== userId) return res.status(403).json({ error: '주최자만 마감 가능' });
    await db.closeMeetup(id);
    await refreshMeetupAnnounce(id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function refreshMeetupAnnounce(meetupId) {
  try {
    const meetup = await db.getMeetup(meetupId);
    if (!meetup || !meetup.channel_id || !meetup.message_ts) return;
    const restaurant = await db.getRestaurantById(meetup.restaurant_id);
    const participants = await db.listMeetupParticipants(meetupId);
    await app.client.chat.update({
      channel: meetup.channel_id,
      ts: meetup.message_ts,
      text: `🍽️ ${restaurant.name} 점심 모집`,
      blocks: blocks.meetupAnnounceBlocks({ meetup, restaurant, participants }),
    });
  } catch (e) {
    console.error('모집 메시지 갱신 실패:', e.message);
  }
}

// 식당 1곳의 리뷰 전체
expressApp.get('/api/reviews/:id', async (req, res) => {
  try {
    const list = await db.listReviews(parseInt(req.params.id, 10));
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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

// 지도에서 방문 체크인 (+ 첫 발견자면 슬랙 채널에 자동 공지)
expressApp.post('/api/visit', expressJson, async (req, res) => {
  try {
    const { restaurantId, userId, userName, channelId } = req.body;
    if (!restaurantId || !userId) return res.status(400).json({ error: 'missing params' });
    const result = await reviewSvc.recordVisit(restaurantId, userId, userName || userId);

    if (result.isFirstDiscoverer && channelId) {
      try {
        const restaurant = await db.getRestaurantById(restaurantId);
        await app.client.chat.postMessage({
          channel: channelId,
          text: `🎉 ${restaurant.name} 첫 발견!`,
          blocks: blocks.firstDiscoveryBlocks(restaurant, userId),
        });
      } catch (e) {
        console.error('첫 발견 공지 실패:', e.message);
      }
    }
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

// 퇴출 복구
expressApp.post('/api/unhide', expressJson, async (req, res) => {
  try {
    const { restaurantId } = req.body;
    if (!restaurantId) return res.status(400).json({ error: 'missing params' });
    await db.unhideRestaurant(restaurantId);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 퇴출된 식당 목록
expressApp.get('/api/hidden', async (_req, res) => {
  try {
    const list = await db.listHiddenRestaurants();
    res.json(list);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 카카오 키워드 검색 (수동 추가용)
expressApp.get('/api/kakao/search', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.json([]);
    const docs = await kakaoSvc.searchFoodByKeyword(q);
    res.json(docs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 식당 수동 추가 (Kakao 검색 결과를 그대로 받아 upsert)
expressApp.post('/api/restaurants', expressJson, async (req, res) => {
  try {
    const doc = req.body;
    if (!doc || !doc.id) return res.status(400).json({ error: 'invalid kakao document' });
    const dist = kakaoSvc.haversine(
      kakaoSvc.OFFICE.y, kakaoSvc.OFFICE.x,
      parseFloat(doc.y), parseFloat(doc.x)
    );
    const restaurant = kakaoSvc.mapKakaoToRestaurant({ ...doc, _distFromOffice: Math.round(dist) });
    const saved = await db.upsertRestaurant(restaurant);
    if (saved.hidden) await db.unhideRestaurant(saved.id);  // 퇴출됐던 곳이면 복구
    res.json(saved);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 사용자 뱃지 (지도 사이드바용)
expressApp.get('/api/badges', async (req, res) => {
  try {
    const userId = req.query.user;
    if (!userId) return res.json({ stats: {}, badges: [] });
    const result = await badgesSvc.getUserBadges(userId);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 최근 활동 피드 (App Home + 지도 사이드바)
expressApp.get('/api/activity', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const list = await db.getRecentActivity(limit);
    res.json(list);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 즐겨찾기 토글
expressApp.post('/api/favorite', expressJson, async (req, res) => {
  try {
    const { restaurantId, userId } = req.body;
    if (!restaurantId || !userId) return res.status(400).json({ error: 'missing params' });
    const result = await db.toggleFavorite(userId, restaurantId);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 핸들러 등록
commands.register(app);
meetups.register(app);

// 전역 에러 처리
app.error(async (err) => {
  console.error('Bolt 글로벌 에러:', err);
});

// Socket Mode 재연결 중 발생하는 finity 상태머신 에러 등 — 크래시 방지
process.on('uncaughtException', (err) => {
  if (err && /Unhandled event '.*disconnect.*' in state/.test(String(err.message))) {
    console.warn('[ignored] Socket Mode 상태머신 일시적 에러:', err.message);
    return;
  }
  console.error('💥 uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('💥 unhandledRejection:', reason);
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
