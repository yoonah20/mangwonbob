// Slack Block Kit 메시지 빌더
const { distanceToWalk, ratingStars, progressBar, mention, truncate } = require('./format');

// 푸터 (모든 메시지 공통)
function footer() {
  return {
    type: 'context',
    elements: [{ type: 'mrkdwn', text: '🌿 망원밥 by 몬스테라하우스' }],
  };
}

// 미탐험 식당 섹션
function unknownRestaurantBlocks(r, comment) {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `🌫️ *${r.name}* | ${r.category} | ${distanceToWalk(r.distance_from_office)}\n_아직 아무도 가보지 않았어요. 첫 탐험가가 되어보세요!_${comment ? `\n${comment}` : ''}`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '나 가봤어! 🥾' },
          style: 'primary',
          action_id: 'visit_restaurant',
          value: String(r.id),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '카카오맵 보기' },
          url: r.kakao_url,
          action_id: 'open_kakao_map',
        },
      ],
    },
  ];
}

// 탐험 완료 식당 섹션
function discoveredRestaurantBlocks(r, comment) {
  const lines = [
    `✅ *${r.name}* | ${r.category} | ${distanceToWalk(r.distance_from_office)}`,
    `${ratingStars(r.avgRating)} · 리뷰 ${r.reviewCount}개 | 🏴 ${r.discovererName ? mention(r.discovererId) : '발견자 미상'} 첫 발견 · 총 ${r.visitCount}회 방문`,
  ];
  if (r.latestReview?.comment) {
    lines.push(`💬 "${truncate(r.latestReview.comment, 80)}" — ${mention(r.latestReview.slack_user_id)}`);
  }
  if (r.tags?.length) {
    lines.push(`🏷️ ${r.tags.join(' ')}`);
  }
  if (comment) lines.push(comment);

  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: lines.join('\n') },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '리뷰 쓰기' },
          action_id: 'open_review_modal',
          value: String(r.id),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '또 갔어요 +1' },
          style: 'primary',
          action_id: 'visit_restaurant',
          value: String(r.id),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '카카오맵 보기' },
          url: r.kakao_url,
          action_id: 'open_kakao_map',
        },
      ],
    },
  ];
}

// 식당 1곳을 상태에 따라 자동으로 렌더
function restaurantBlocks(r, comment) {
  return r.discovered
    ? discoveredRestaurantBlocks(r, comment)
    : unknownRestaurantBlocks(r, comment);
}

// /밥 응답 — 탐험 현황 + 추천 3곳
function homeBlocks({ teamProgress, recommendations }) {
  const ratio = teamProgress.total ? teamProgress.discovered / teamProgress.total : 0;
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '🍚 오늘의 망원밥' },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*팀 탐험 현황*  ${teamProgress.discovered} / ${teamProgress.total}곳   ${progressBar(ratio)}  ${Math.round(ratio * 100)}%`,
      },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: '*✨ 오늘의 추천 식당*' },
    },
  ];
  recommendations.forEach((rec, i) => {
    if (i > 0) blocks.push({ type: 'divider' });
    blocks.push(...restaurantBlocks(rec.restaurant, rec.comment));
  });
  blocks.push(footer());
  return blocks;
}

// 첫 발견 채널 공지
function firstDiscoveryBlocks(restaurant, userId) {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `🎉 *새로운 식당이 발견됐어요!*\n${mention(userId)} 님이 *"${restaurant.name}"* 을(를) 처음 발견했습니다!\n📍 ${restaurant.category} · ${distanceToWalk(restaurant.distance_from_office)}\n_지도에 새로 추가됐어요. 다들 가보세요! 🗺️_`,
      },
    },
    footer(),
  ];
}

// 방문 확인 메시지
function visitConfirmBlocks(restaurant, { isFirstDiscoverer, userVisitCount, isRegular }) {
  const lines = [`🥾 *${restaurant.name}* 방문 기록 완료!`];
  if (isFirstDiscoverer) lines.push('🏴 *첫 발견자*로 등록됐어요!');
  if (isRegular) lines.push(`👑 단골 등극! (이 식당 ${userVisitCount}번째 방문)`);
  else lines.push(`(이 식당 ${userVisitCount}번째 방문)`);
  return [
    { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '바로 리뷰 쓰기 ✍️' },
          style: 'primary',
          action_id: 'open_review_modal',
          value: String(restaurant.id),
        },
      ],
    },
    footer(),
  ];
}

// /밥 탐험 — 개인 현황
function explorationBlocks(userId, exp) {
  const ratio = exp.totalRestaurants ? exp.discoveredCount / exp.totalRestaurants : 0;
  const firstNames = exp.firstDiscoveries.slice(0, 5).map(r => r.name).join(', ') || '아직 없음';
  const regularNames = exp.regulars.slice(0, 5)
    .map(r => `${r.name} ${r.visit_count}회`).join(', ') || '아직 없음';

  const text = [
    `🗺️ *${mention(userId)}의 탐험 기록*`,
    '━━━━━━━━━━━━━━━━━━━',
    `발견한 식당   *${exp.discoveredCount} / ${exp.totalRestaurants}곳*   ${progressBar(ratio)} ${Math.round(ratio * 100)}%`,
    `🏴 첫 발견      *${exp.firstCount}곳* (${firstNames})`,
    `👑 단골 (3회+)  *${exp.regulars.length}곳* (${regularNames})`,
    `🥈 팀 내 순위   *${exp.rank}위 / ${exp.totalUsers}명*`,
    '━━━━━━━━━━━━━━━━━━━',
  ].join('\n');

  return [
    { type: 'section', text: { type: 'mrkdwn', text } },
    footer(),
  ];
}

// /밥 지도 — 팀 전체 현황
function teamMapBlocks(team, mapUrl) {
  const ratio = team.total ? team.discovered / team.total : 0;
  const lines = [
    '🗺️ *몬스테라하우스 탐험 지도*',
    '━━━━━━━━━━━━━━━━━━━',
    `발견 완료   *${team.discovered} / ${team.total}곳*   ${progressBar(ratio)} ${Math.round(ratio * 100)}%`,
    `미발견      *${team.total - team.discovered}곳*`,
    '',
  ];
  if (team.explorerKing) {
    lines.push(`🥾 *탐험왕* — ${mention(team.explorerKing.slack_user_id)} (${team.explorerKing.discovered_count}곳 발견)`);
  }
  if (team.firstKing) {
    lines.push(`🏴 *첫발견왕* — ${mention(team.firstKing.slack_user_id)} (${team.firstKing.first_count}곳 첫 발견)`);
  }
  if (team.regularKing) {
    lines.push(`👑 *단골왕* — ${mention(team.regularKing.slack_user_id)} (${team.regularKing.restaurant_name} ${team.regularKing.visit_count}회)`);
  }
  lines.push('━━━━━━━━━━━━━━━━━━━');

  const result = [
    { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } },
  ];
  if (mapUrl) {
    result.push({
      type: 'actions',
      elements: [{
        type: 'button',
        text: { type: 'plain_text', text: '🗺️ 지도에서 보기' },
        url: mapUrl,
        action_id: 'open_map_view',
        style: 'primary',
      }],
    });
  }
  result.push(footer());
  return result;
}

// 리뷰 작성 Modal
function reviewModal(restaurant) {
  return {
    type: 'modal',
    callback_id: 'submit_review',
    private_metadata: String(restaurant.id),
    title: { type: 'plain_text', text: '리뷰 작성' },
    submit: { type: 'plain_text', text: '제출' },
    close: { type: 'plain_text', text: '취소' },
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${restaurant.name}* 에 대한 리뷰를 남겨주세요 🍚` },
      },
      {
        type: 'input',
        block_id: 'rating_block',
        label: { type: 'plain_text', text: '별점' },
        element: {
          type: 'static_select',
          action_id: 'rating',
          placeholder: { type: 'plain_text', text: '별점을 선택하세요' },
          options: [
            { text: { type: 'plain_text', text: '⭐⭐⭐⭐⭐ (5)' }, value: '5' },
            { text: { type: 'plain_text', text: '⭐⭐⭐⭐ (4)' }, value: '4' },
            { text: { type: 'plain_text', text: '⭐⭐⭐ (3)' }, value: '3' },
            { text: { type: 'plain_text', text: '⭐⭐ (2)' }, value: '2' },
            { text: { type: 'plain_text', text: '⭐ (1)' }, value: '1' },
          ],
        },
      },
      {
        type: 'input',
        block_id: 'comment_block',
        optional: true,
        label: { type: 'plain_text', text: '한 줄 코멘트' },
        element: {
          type: 'plain_text_input',
          action_id: 'comment',
          multiline: true,
          max_length: 300,
          placeholder: { type: 'plain_text', text: '국물이 진해요, 혼밥 가능, 점심 특선 추천 등' },
        },
      },
      {
        type: 'input',
        block_id: 'tags_block',
        optional: true,
        label: { type: 'plain_text', text: '태그' },
        element: {
          type: 'checkboxes',
          action_id: 'tags',
          options: [
            { text: { type: 'plain_text', text: '#혼밥' }, value: '#혼밥' },
            { text: { type: 'plain_text', text: '#단체' }, value: '#단체' },
            { text: { type: 'plain_text', text: '#웨이팅' }, value: '#웨이팅' },
            { text: { type: 'plain_text', text: '#가성비' }, value: '#가성비' },
            { text: { type: 'plain_text', text: '#빠름' }, value: '#빠름' },
          ],
        },
      },
    ],
  };
}

module.exports = {
  restaurantBlocks,
  unknownRestaurantBlocks,
  discoveredRestaurantBlocks,
  homeBlocks,
  firstDiscoveryBlocks,
  visitConfirmBlocks,
  explorationBlocks,
  teamMapBlocks,
  reviewModal,
  footer,
};
