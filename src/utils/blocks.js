// Slack Block Kit 메시지 빌더 — /밥 응답은 지도 진입점 역할만
const { progressBar, mention, timeAgo, truncate } = require('./format');

function formatActivity(a) {
  const ago = timeAgo(a.at);
  const user = mention(a.user_id);
  const rest = `*${a.restaurant_name}*`;
  if (a.kind === 'visit') {
    if (a.first_discovery) return `🏴 ${user} ${rest} 첫 발견! · _${ago}_`;
    return `🥾 ${user} ${rest} 체크인 · _${ago}_`;
  }
  if (a.kind === 'review') {
    const stars = '⭐'.repeat(Math.max(0, Math.min(5, a.rating || 0)));
    const cmt = a.comment ? ` "${truncate(a.comment, 50)}"` : '';
    return `📝 ${user} ${rest} ${stars}${cmt} · _${ago}_`;
  }
  if (a.kind === 'meetup') {
    // 활동 피드는 모집 생성 시점만 알 뿐 실제 시간은 a.at가 아님 — 그대로 표기
    return `🍽️ ${user} ${rest} 모집 · _${ago}_`;
  }
  return '';
}

function footer() {
  return {
    type: 'context',
    elements: [{ type: 'mrkdwn', text: '🌿 망원밥 by 몬스테라하우스' }],
  };
}

function catBtn(text, value) {
  return {
    type: 'button',
    text: { type: 'plain_text', text, emoji: true },
    action_id: `pick_category:${value}`,
    value,
  };
}

// /밥 응답 — 대화형: 어떤 거 먹고 싶냐고 물어봄
function homeBlocks({ teamProgress, mapUrl }) {
  const ratio = teamProgress.total ? teamProgress.discovered / teamProgress.total : 0;
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: '🍚 오늘 뭐 먹지?' } },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `팀 탐험 *${teamProgress.discovered} / ${teamProgress.total}곳*   ${progressBar(ratio)} ${Math.round(ratio * 100)}%\n\n_기분 골라보세요_`,
      },
    },
    {
      type: 'actions',
      elements: [
        catBtn('🎲 아무거나', '_any'),
        catBtn('🌫️ 안 가본 곳', '_unvisited'),
        catBtn('🔥 핫플', '_popular'),
      ],
    },
    {
      type: 'actions',
      elements: [
        catBtn('🍚 한식', '한식'),
        catBtn('🍣 일식', '일식'),
        catBtn('🥢 중식', '중식'),
        catBtn('🍕 양식', '양식'),
      ],
    },
    {
      type: 'actions',
      elements: [
        catBtn('🥩 고기', '고기'),
        catBtn('🦞 해산물', '해산물'),
        catBtn('🌶️ 분식', '분식'),
        catBtn('🍗 치킨', '치킨'),
      ],
    },
    {
      type: 'actions',
      elements: [
        catBtn('☕ 카페', '카페'),
        catBtn('🥐 빵집', '빵집'),
        catBtn('🍺 술집', '술집'),
        catBtn('🍜 아시아', '아시아'),
      ],
    },
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

// 카테고리 선택 후 추천 결과
function pickedBlocks({ category, recommendations, mapUrl }) {
  const titleMap = {
    _any: '🎲 아무거나',
    _unvisited: '🌫️ 안 가본 곳',
    _popular: '🔥 핫플',
  };
  const title = titleMap[category] || `${category}`;

  const recLines = (recommendations || []).map(({ restaurant: r, comment }) => {
    const tag = r.discovered
      ? (r.avgRating >= 4.5 ? '⭐' : r.visitCount >= 10 ? '🔥' : '✅')
      : '🌫️';
    const stat = r.discovered
      ? (r.avgRating ? `⭐${r.avgRating}` : `${r.visitCount || 0}회`)
      : '미탐험';
    const head = `${tag} *${r.name}* — ${r.category || ''} · ${stat}`;
    return comment ? `${head}\n   _${comment}_` : head;
  }).join('\n');

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `${title} 추천 🍚` } },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: recLines || '_여기엔 추천할 곳이 없네요_' },
    },
    {
      type: 'actions',
      elements: [
        { type: 'button', text: { type: 'plain_text', text: '🔄 다른 추천' },
          action_id: `pick_category:${category}`, value: category },
        { type: 'button', text: { type: 'plain_text', text: '⬅️ 다시 고르기' },
          action_id: 'back_to_home' },
        ...(mapUrl ? [{ type: 'button', text: { type: 'plain_text', text: '🗺️ 지도' },
          url: mapUrl, action_id: 'open_map_view', style: 'primary' }] : []),
      ],
    },
    footer(),
  ];
  return blocks;
}

// 첫 발견 채널 공지 (지도 체크인 시)
// review가 있으면 별점/코멘트/태그까지, mapUrl이 있으면 지도 이동 버튼까지 함께 노출.
function firstDiscoveryBlocks({ restaurant, userId, mapUrl, review }) {
  const lines = [
    `🎉 *새로운 식당이 발견됐어요!*`,
    `${mention(userId)} 님이 *"${restaurant.name}"* 을(를) 처음 발견했습니다!`,
    `📍 ${restaurant.category}`,
  ];

  if (review && review.rating) {
    const r = Math.max(0, Math.min(5, review.rating));
    const stars = '⭐'.repeat(r) + '☆'.repeat(5 - r);
    lines.push(`\n${stars}  *${Number(review.rating).toFixed(1)}*`);
    if (review.comment) lines.push(`💬 _"${truncate(review.comment, 120)}"_`);
    if (review.tags && review.tags.length) {
      lines.push(review.tags.map(t => `\`${t}\``).join(' '));
    }
  }

  const out = [
    { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } },
  ];
  if (mapUrl) {
    out.push({
      type: 'actions',
      elements: [{
        type: 'button',
        text: { type: 'plain_text', text: '🗺️ 앱에서 보기', emoji: true },
        url: mapUrl,
        action_id: 'open_map_view',
        style: 'primary',
      }],
    });
  }
  out.push(footer());
  return out;
}

// 점심/저녁 자동 판별 (16시 미만 = 점심)
function mealLabel(date) {
  return date.getHours() < 16 ? '점심' : '저녁';
}

// 점심 모집 Slack 메시지
function meetupAnnounceBlocks({ meetup, restaurant, participants }) {
  const time = new Date(meetup.meet_at);
  const meal = mealLabel(time);
  const hh = time.getHours();
  const mm = String(time.getMinutes()).padStart(2, '0');
  const today = new Date(); today.setHours(0,0,0,0);
  const meetDay = new Date(time); meetDay.setHours(0,0,0,0);
  const dayDiff = Math.round((meetDay - today) / (24*60*60*1000));
  const dayLabel = dayDiff === 0 ? '오늘' : dayDiff === 1 ? '내일' : `${time.getMonth()+1}/${time.getDate()}`;
  const timeStr = `${dayLabel} ${hh}:${mm}`;

  const lines = [
    `🍽️ *${meal} 모집!*`,
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

// App Home — 사이드바에서 망원밥 앱 클릭 시 보이는 화면
function appHomeView({ teamProgress, mapUrl, userName, activities }) {
  const ratio = teamProgress.total ? teamProgress.discovered / teamProgress.total : 0;
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: '🍚 망원밥' } },
    { type: 'section', text: { type: 'mrkdwn',
      text: `${userName ? `*${userName}* 님, ` : ''}오늘 뭐 먹지?\n팀 탐험 *${teamProgress.discovered} / ${teamProgress.total}곳*   ${progressBar(ratio)} ${Math.round(ratio * 100)}%` } },
  ];
  if (mapUrl) {
    blocks.push({
      type: 'actions',
      elements: [{
        type: 'button',
        text: { type: 'plain_text', text: '🗺️ 지도 열기' },
        url: mapUrl,
        action_id: 'open_map_view',
        style: 'primary',
      }],
    });
  } else {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '_PUBLIC_URL 환경변수를 설정해주세요_' } });
  }
  // 최근 활동 피드
  if (activities && activities.length) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '*🕐 최근 활동*' },
    });
    // Slack section의 mrkdwn은 길이 제한이 있어 묶어서 표시
    const lines = activities.slice(0, 15).map(formatActivity).filter(Boolean);
    // 5개씩 끊어 section 추가 (3000자 제한 방어)
    for (let i = 0; i < lines.length; i += 5) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: lines.slice(i, i + 5).join('\n') },
      });
    }
  }
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: '🌿 망원밥 by 몬스테라하우스 · 채팅에서 `/밥` 으로도 사용 가능' }] });
  return { type: 'home', blocks };
}

module.exports = {
  homeBlocks,
  pickedBlocks,
  appHomeView,
  firstDiscoveryBlocks,
  meetupAnnounceBlocks,
  mealLabel,
  footer,
};
