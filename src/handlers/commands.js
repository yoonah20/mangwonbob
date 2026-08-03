// /밥 슬래시 커맨드 — 대화형 카테고리 prompt → 추천 결과
const db = require('../db/queries');
const restaurantSvc = require('../services/restaurant');
const deepseek = require('../services/deepseek');
const blocks = require('../utils/blocks');
const { buildMapUrl } = require('../utils/format');

async function getPicksForCategory(category, limit = 3) {
  if (category === '_unvisited') return restaurantSvc.getUnvisitedPicks(limit);
  if (category === '_popular') return restaurantSvc.getPopularPicks(limit);
  if (category === '_any' || !category) return restaurantSvc.getRecommendations(null, limit);
  return restaurantSvc.getRecommendations(category, limit);
}

async function enrichWithComment(restaurants) {
  return Promise.all((restaurants || []).filter(Boolean).map(async (r) => ({
    restaurant: r,
    comment: await deepseek.generateRecommendation(r, {
      discovered: r.discovered,
      avgRating: r.avgRating,
      reviewCount: r.reviewCount,
      sampleComment: r.latestReview?.comment,
    }),
  })));
}

function register(app) {
  // ─── /밥 ──────────────────────────────────────────
  app.command('/밥', async ({ command, ack, respond }) => {
    await ack();
    try {
      const teamProgress = await db.getTeamProgress();
      return respond({
        response_type: 'ephemeral',
        text: '🍚 오늘 뭐 먹지?',
        blocks: blocks.homeBlocks({
          teamProgress,
          mapUrl: buildMapUrl(command.user_id, command.user_name, command.channel_id),
        }),
      });
    } catch (e) {
      console.error('command error:', e);
      return respond({ text: `❌ 오류가 발생했어요: ${e.message}` });
    }
  });

  // 카테고리 선택 → 추천 결과로 같은 메시지 업데이트 (action_id: pick_category:한식 등)
  app.action(/^pick_category:/, async ({ ack, body, action, respond }) => {
    await ack();
    try {
      const category = action.value;
      const picks = await getPicksForCategory(category, 3);
      const enriched = await enrichWithComment(picks);
      await respond({
        response_type: 'ephemeral',
        replace_original: true,
        text: `🍚 ${category} 추천`,
        blocks: blocks.pickedBlocks({
          category,
          recommendations: enriched,
          mapUrl: buildMapUrl(body.user.id, body.user.username || body.user.name, body.channel?.id),
        }),
      });
    } catch (e) {
      console.error('pick_category error:', e);
    }
  });

  // 다시 고르기 → 처음 화면으로
  app.action('back_to_home', async ({ ack, body, respond }) => {
    await ack();
    try {
      const teamProgress = await db.getTeamProgress();
      await respond({
        response_type: 'ephemeral',
        replace_original: true,
        text: '🍚 오늘 뭐 먹지?',
        blocks: blocks.homeBlocks({
          teamProgress,
          mapUrl: buildMapUrl(body.user.id, body.user.username || body.user.name, body.channel?.id),
        }),
      });
    } catch (e) {
      console.error('back_to_home error:', e);
    }
  });

  app.action('open_map_view', async ({ ack }) => { await ack(); });

  // ─── App Home (사이드바에서 앱 클릭 시) ─────────────────
  app.event('app_home_opened', async ({ event, client }) => {
    if (event.tab !== 'home') return;
    try {
      const [teamProgress, activities] = await Promise.all([
        db.getTeamProgress(),
        db.getRecentActivity(15),
      ]);
      let userName = '';
      try {
        const info = await client.users.info({ user: event.user });
        userName = info.user.profile?.display_name
          || info.user.profile?.real_name
          || info.user.name || '';
      } catch (e) { /* ignore */ }
      const mapUrl = buildMapUrl(event.user, userName, process.env.MEETUP_CHANNEL_ID || '');
      await client.views.publish({
        user_id: event.user,
        view: blocks.appHomeView({ teamProgress, mapUrl, userName, activities }),
      });
    } catch (e) {
      console.error('app_home_opened error:', e);
    }
  });
}

module.exports = { register };
