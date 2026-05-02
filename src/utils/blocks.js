// Slack Block Kit 메시지 빌더 — /밥 응답은 지도 진입점 역할만
const { progressBar, mention } = require('./format');

function footer() {
  return {
    type: 'context',
    elements: [{ type: 'mrkdwn', text: '🌿 망원밥 by 몬스테라하우스' }],
  };
}

// /밥 응답 — 헤더 + 팀 진척도 + 추천 3곳(이름만) + 지도 버튼
function homeBlocks({ teamProgress, recommendations, mapUrl }) {
  const ratio = teamProgress.total ? teamProgress.discovered / teamProgress.total : 0;
  const recLines = (recommendations || []).map(({ restaurant: r }) => {
    const tag = r.discovered
      ? (r.avgRating >= 4.5 ? '⭐' : r.visitCount >= 10 ? '🔥' : '✅')
      : '🌫️';
    const stat = r.discovered
      ? (r.avgRating ? `⭐${r.avgRating}` : `${r.visitCount || 0}회`)
      : '미탐험';
    return `${tag} *${r.name}* — ${r.category || ''} · ${stat}`;
  }).join('\n');

  const text = [
    `*${teamProgress.discovered} / ${teamProgress.total}곳* 탐험   ${progressBar(ratio)} ${Math.round(ratio * 100)}%`,
    recLines ? '' : null,
    recLines || null,
  ].filter(x => x !== null).join('\n');

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: '🍚 오늘의 망원밥' } },
    { type: 'section', text: { type: 'mrkdwn', text } },
  ];
  if (mapUrl) {
    blocks.push({
      type: 'actions',
      elements: [{
        type: 'button',
        text: { type: 'plain_text', text: '🗺️ 지도에서 전체 보기' },
        url: mapUrl,
        action_id: 'open_map_view',
        style: 'primary',
      }],
    });
  }
  blocks.push(footer());
  return blocks;
}

// 첫 발견 채널 공지 (지도 체크인 시)
function firstDiscoveryBlocks(restaurant, userId) {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `🎉 *새로운 식당이 발견됐어요!*\n${mention(userId)} 님이 *"${restaurant.name}"* 을(를) 처음 발견했습니다!\n📍 ${restaurant.category}`,
      },
    },
    footer(),
  ];
}

// 점심 모집 Slack 메시지
function meetupAnnounceBlocks({ meetup, restaurant, participants }) {
  const time = new Date(meetup.meet_at);
  const hh = time.getHours();
  const mm = String(time.getMinutes()).padStart(2, '0');
  const today = new Date(); today.setHours(0,0,0,0);
  const meetDay = new Date(time); meetDay.setHours(0,0,0,0);
  const dayDiff = Math.round((meetDay - today) / (24*60*60*1000));
  const dayLabel = dayDiff === 0 ? '오늘' : dayDiff === 1 ? '내일' : `${time.getMonth()+1}/${time.getDate()}`;
  const timeStr = `${dayLabel} ${hh}:${mm}`;

  const lines = [
    `🍽️ *점심 모집!*`,
    `${mention(meetup.organizer_id)}님이 *${restaurant.name}* (${restaurant.category}) 갈 사람 모집해요`,
    `📅 ${timeStr}`,
  ];
  if (meetup.note) lines.push(`💬 _${meetup.note}_`);
  lines.push('');
  const participantMentions = participants.length
    ? participants.map(p => mention(p.slack_user_id)).join(' ')
    : '_아직 없음_';
  lines.push(`✋ *참여 (${participants.length}명)*: ${participantMentions}`);

  const result = [
    { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } },
  ];
  if (meetup.status === 'open') {
    result.push({
      type: 'actions',
      elements: [
        { type: 'button', style: 'primary',
          text: { type: 'plain_text', text: '✋ 참여하기' },
          action_id: 'join_meetup', value: String(meetup.id) },
        { type: 'button',
          text: { type: 'plain_text', text: '나갈래' },
          action_id: 'leave_meetup', value: String(meetup.id) },
        { type: 'button',
          text: { type: 'plain_text', text: '🔒 모집 마감' },
          action_id: 'close_meetup', value: String(meetup.id) },
      ],
    });
  } else {
    result.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '🔒 모집이 마감됐어요' }],
    });
  }
  result.push(footer());
  return result;
}

module.exports = {
  homeBlocks,
  firstDiscoveryBlocks,
  meetupAnnounceBlocks,
  footer,
};
