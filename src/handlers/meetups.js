// 점심 모집 Slack 인터랙션 — 참여 / 나가기 / 마감
const db = require('../db/queries');
const blocks = require('../utils/blocks');

async function refreshAnnounce(client, meetupId) {
  const meetup = await db.getMeetup(meetupId);
  if (!meetup || !meetup.channel_id || !meetup.message_ts) return;
  const restaurant = await db.getRestaurantById(meetup.restaurant_id);
  const participants = await db.listMeetupParticipants(meetupId);
  await client.chat.update({
    channel: meetup.channel_id,
    ts: meetup.message_ts,
    text: `🍽️ ${restaurant.name} ${blocks.mealLabel(new Date(meetup.meet_at))} 모집`,
    blocks: blocks.meetupAnnounceBlocks({ meetup, restaurant, participants }),
  });
}

function register(app) {
  app.action('join_meetup', async ({ ack, body, action, client }) => {
    await ack();
    const meetupId = parseInt(action.value, 10);
    const meetup = await db.getMeetup(meetupId);
    if (!meetup || meetup.status !== 'open') return;
    await db.joinMeetup(meetupId, body.user.id, body.user.username || body.user.name);
    await refreshAnnounce(client, meetupId);
  });

  app.action('leave_meetup', async ({ ack, body, action, client }) => {
    await ack();
    const meetupId = parseInt(action.value, 10);
    await db.leaveMeetup(meetupId, body.user.id);
    await refreshAnnounce(client, meetupId);
  });

  app.action('close_meetup', async ({ ack, body, action, client, respond }) => {
    await ack();
    const meetupId = parseInt(action.value, 10);
    const meetup = await db.getMeetup(meetupId);
    if (!meetup) return;
    if (meetup.organizer_id !== body.user.id) {
      try {
        await client.chat.postEphemeral({
          channel: meetup.channel_id,
          user: body.user.id,
          text: '주최자만 모집을 마감할 수 있어요.',
        });
      } catch (e) { /* ignore */ }
      return;
    }
    await db.closeMeetup(meetupId);
    await refreshAnnounce(client, meetupId);
  });
}

module.exports = { register };
