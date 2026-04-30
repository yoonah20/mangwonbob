// 거리/별점 포맷 헬퍼

// 미터 → 도보 N분 (성인 평균 80m/min)
function distanceToWalk(meters) {
  if (!meters && meters !== 0) return '거리 미상';
  const min = Math.max(1, Math.round(meters / 80));
  return `도보 ${min}분`;
}

// 별점 숫자 → ⭐ 표시
function ratingStars(rating) {
  if (!rating) return '평점 없음';
  return `⭐ ${Number(rating).toFixed(1)}`;
}

// 프로그레스바 (0~1) → ▓▓▓░░░░░░░ 형태
function progressBar(ratio, width = 10) {
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
  return '▓'.repeat(filled) + '░'.repeat(width - filled);
}

// 슬랙 mention 포맷
function mention(userId) {
  return `<@${userId}>`;
}

// 안전한 텍스트 자르기
function truncate(text, max = 80) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

module.exports = {
  distanceToWalk,
  ratingStars,
  progressBar,
  mention,
  truncate,
};
