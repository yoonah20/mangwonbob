// /밥 슬래시 커맨드 라우팅
const db = require('../db/queries');
const restaurantSvc = require('../services/restaurant');
const reviewSvc = require('../services/review');
const rankingSvc = require('../services/ranking');
const deepseek = require('../services/deepseek');
const blocks = require('../utils/blocks');

const CATEGORIES = ['한식', '일식', '중식', '양식', '카페', '분식', '아시아', '치킨'];

// 텍스트 파싱 — "방문 할매국밥" / "리뷰 할매국밥" / "탐험" / "지도" / "한식"
function parseCommand(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return { type: 'home' };

  const tokens = trimmed.split(/\s+/);
  const head = tokens[0];
  const rest = tokens.slice(1).join(' ');

  if (head === '방문' && rest) return { type: 'visit', name: rest };
  if (head === '리뷰' && rest) return { type: 'review', name: rest };
  if (head === '탐험') return { type: 'exploration' };
  if (head === '지도') return { type: 'map' };
  if (CATEGORIES.some(c => head.includes(c))) return { type: 'home', category: head };

  // 그 외엔 식당명으로 검색
  return { type: 'search', name: trimmed };
}

function register(app) {
  // ─── /밥 ──────────────────────────────────────────
  app.command('/밥', async ({ command, ack, respond, client }) => {
    await ack();
    const parsed = parseCommand(command.text);

    try {
      switch (parsed.type) {
        case 'home':
          return respond(await renderHome(parsed.category));
        case 'exploration':
          return respond(await renderExploration(command.user_id));
        case 'map':
          return respond(await renderMap());
        case 'visit':
          return handleVisit({ name: parsed.name, command, client, respond });
        case 'review':
          return handleReviewOpen({ name: parsed.name, command, client, respond });
        case 'search':
          return respond(await renderSearch(parsed.name));
      }
    } catch (e) {
      console.error('command error:', e);
      return respond({ text: `❌ 오류가 발생했어요: ${e.message}` });
    }
  });

  // ─── 버튼: 방문 등록 ─────────────────────────────────
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

    // 첫 발견자면 채널 공지
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

  // ─── 버튼: 리뷰 모달 오픈 ────────────────────────────
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

  // ─── 버튼: 카카오맵 (URL 이동만) ────────────────────
  app.action('open_kakao_map', async ({ ack }) => { await ack(); });
}

// ─── 화면 렌더링 ──────────────────────────────────────

async function renderHome(category) {
  const teamProgress = await db.getTeamProgress();
  const recommendations = await restaurantSvc.getRecommendations(category, 3);

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
    blocks: blocks.homeBlocks({ teamProgress, recommendations: enriched }),
  };
}

async function renderExploration(userId) {
  const exp = await rankingSvc.getUserExploration(userId);
  return {
    response_type: 'ephemeral',
    text: '🗺️ 내 탐험 기록',
    blocks: blocks.explorationBlocks(userId, exp),
  };
}

async function renderMap() {
  const team = await rankingSvc.getTeamMap();
  return {
    response_type: 'in_channel',
    text: '🗺️ 팀 탐험 지도',
    blocks: blocks.teamMapBlocks(team),
  };
}

async function renderSearch(name) {
  const r = await restaurantSvc.findByName(name);
  if (!r) {
    return { text: `🔍 "${name}" 와(과) 일치하는 식당을 찾지 못했어요.` };
  }
  const comment = await deepseek.generateRecommendation(r, {
    discovered: r.discovered,
    avgRating: r.avgRating,
    reviewCount: r.reviewCount,
    sampleComment: r.latestReview?.comment,
  });
  return {
    response_type: 'ephemeral',
    text: r.name,
    blocks: [...blocks.restaurantBlocks(r, comment), blocks.footer()],
  };
}

// /밥 방문 [식당명] — 즉시 방문 기록 + 리뷰 모달 유도
async function handleVisit({ name, command, client, respond }) {
  const r = await restaurantSvc.findByName(name);
  if (!r) {
    return respond({ text: `🔍 "${name}" 와(과) 일치하는 식당을 찾지 못했어요.` });
  }
  const result = await reviewSvc.recordVisit(r.id, command.user_id, command.user_name);

  if (result.isFirstDiscoverer) {
    try {
      await client.chat.postMessage({
        channel: command.channel_id,
        text: `🎉 ${r.name} 첫 발견!`,
        blocks: blocks.firstDiscoveryBlocks(r, command.user_id),
      });
    } catch (e) {
      console.error('첫 발견 공지 실패:', e.message);
    }
  }

  return respond({
    response_type: 'ephemeral',
    text: `${r.name} 방문 기록 완료`,
    blocks: blocks.visitConfirmBlocks(r, result),
  });
}

// /밥 리뷰 [식당명] — 리뷰 모달 오픈
async function handleReviewOpen({ name, command, client, respond }) {
  const r = await restaurantSvc.findByName(name);
  if (!r) {
    return respond({ text: `🔍 "${name}" 와(과) 일치하는 식당을 찾지 못했어요.` });
  }
  await client.views.open({
    trigger_id: command.trigger_id,
    view: blocks.reviewModal(r),
  });
}

module.exports = { register };
