// /밥 슬래시 커맨드 — 지도 진입점만
const db = require('../db/queries');
const restaurantSvc = require('../services/restaurant');
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
  app.command('/밥', async ({ command, ack, respond }) => {
    await ack();
    try {
      return respond(await renderHome(command.user_id, command.user_name, command.channel_id));
    } catch (e) {
      console.error('command error:', e);
      return respond({ text: `❌ 오류가 발생했어요: ${e.message}` });
    }
  });

  app.action('open_map_view', async ({ ack }) => { await ack(); });
}

async function renderHome(userId, userName, channelId) {
  const teamProgress = await db.getTeamProgress();
  const recommendations = await restaurantSvc.getRecommendations(null, 3);
  const enriched = recommendations.filter(Boolean).map(r => ({ restaurant: r }));
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
