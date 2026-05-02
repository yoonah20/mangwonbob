// /밥 슬래시 커맨드 — 홈(추천 + 지도 버튼)만 노출
// 그 외 모든 액션(방문/리뷰/탐험/지도/검색)은 지도 페이지에서 처리
const db = require('../db/queries');
const restaurantSvc = require('../services/restaurant');
const reviewSvc = require('../services/review');
const deepseek = require('../services/deepseek');
const blocks = require('../utils/blocks');

function buildMapUrl(userId, userName, channelId) {
  if (!process.env.PUBLIC_URL) return null;
  const base = process.env.PUBLIC_URL.replace(/\/$/, '');
  const params = new URLSearchParams({
    user: userId || '',
    name: userName || '',
    channel: channelId || '',
  });
  return `${base}/map?${params.toString()}`;
}

function register(app) {
  // ─── /밥 ──────────────────────────────────────────
  app.command('/밥', async ({ command, ack, respond }) => {
    await ack();
    try {
      return respond(await renderHome(command.user_id, command.user_name, command.channel_id));
    } catch (e) {
      console.error('command error:', e);
      return respond({ text: `❌ 오류가 발생했어요: ${e.message}` });
    }
  });

  // ─── 추천 카드 버튼: 방문 등록 ───────────────────────
  app.action('visit_restaurant', async ({ ack, body, action, client, respond }) => {
    await ack();
    const restaurantId = parseInt(action.value, 10);
    const restaurant = await db.getRestaurantById(restaurantId);
    if (!restaurant) return;

    const result = await reviewSvc.recordVisit(
      restaurantId,
      body.user.id,
      body.user.username || body.user.name
    );

    if (result.isFirstDiscoverer && body.channel?.id) {
      try {
        await client.chat.postMessage({
          channel: body.channel.id,
          text: `🎉 ${restaurant.name} 첫 발견!`,
          blocks: blocks.firstDiscoveryBlocks(restaurant, body.user.id),
        });
      } catch (e) {
        console.error('첫 발견 공지 실패:', e.message);
      }
    }

    await respond({
      response_type: 'ephemeral',
      replace_original: false,
      text: `${restaurant.name} 방문 기록 완료`,
      blocks: blocks.visitConfirmBlocks(restaurant, result),
    });
  });

  // ─── 추천 카드 버튼: 리뷰 모달 ───────────────────────
  app.action('open_review_modal', async ({ ack, body, action, client }) => {
    await ack();
    const restaurantId = parseInt(action.value, 10);
    const restaurant = await db.getRestaurantById(restaurantId);
    if (!restaurant) return;
    await client.views.open({
      trigger_id: body.trigger_id,
      view: blocks.reviewModal(restaurant),
    });
  });

  // ─── URL 버튼들 (ack만) ──────────────────────────────
  app.action('open_kakao_map', async ({ ack }) => { await ack(); });
  app.action('open_map_view', async ({ ack }) => { await ack(); });
}

async function renderHome(userId, userName, channelId) {
  const teamProgress = await db.getTeamProgress();
  const recommendations = await restaurantSvc.getRecommendations(null, 3);

  const enriched = await Promise.all(
    recommendations.filter(Boolean).map(async (r) => ({
      restaurant: r,
      comment: await deepseek.generateRecommendation(r, {
        discovered: r.discovered,
        avgRating: r.avgRating,
        reviewCount: r.reviewCount,
        sampleComment: r.latestReview?.comment,
      }),
    }))
  );

  return {
    response_type: 'ephemeral',
    text: '🍚 오늘의 망원밥',
    blocks: blocks.homeBlocks({
      teamProgress,
      recommendations: enriched,
      mapUrl: buildMapUrl(userId, userName, channelId),
    }),
  };
}

module.exports = { register };
