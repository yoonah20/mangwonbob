// DeepSeek API — 추천 한 줄 코멘트 생성 (OpenAI 호환 인터페이스)
const axios = require('axios');

const BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 10_000,
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
  },
});

// 식당 1곳에 대한 한 줄 추천 코멘트 생성
async function generateRecommendation(restaurant, opts = {}) {
  if (!process.env.DEEPSEEK_API_KEY) {
    return defaultComment(restaurant, opts);
  }

  const { discovered, avgRating, reviewCount, sampleComment } = opts;
  const status = discovered
    ? `방문자 평균 ${avgRating || '?'}점, 리뷰 ${reviewCount || 0}개`
    : '아직 아무도 가보지 않은 미탐험 식당';

  const prompt = `너는 망원동 회사의 점심 메이트야. 직원들에게 식당을 한 줄로 추천해줘.

식당: ${restaurant.name}
카테고리: ${restaurant.category}
거리: ${restaurant.distance_from_office}m
상태: ${status}
${sampleComment ? `최근 리뷰: "${sampleComment}"` : ''}

규칙:
- 30자 이내, 친근한 반말
- 이모지 1개만 사용
- 과장 금지, 식당 이름 다시 쓰지 말 것
- 한 줄만 출력 (따옴표 없이)`;

  try {
    const { data } = await client.post('/chat/completions', {
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 80,
      temperature: 0.8,
    });
    const text = data?.choices?.[0]?.message?.content?.trim();
    return text || defaultComment(restaurant, opts);
  } catch (e) {
    console.error('DeepSeek API 오류:', e.response?.data || e.message);
    return defaultComment(restaurant, opts);
  }
}

// 폴백 코멘트
function defaultComment(restaurant, opts = {}) {
  if (!opts.discovered) return '🌫️ 첫 탐험가가 되어보세요!';
  if (opts.avgRating >= 4.5) return '⭐ 직원들이 강추하는 곳';
  if (opts.avgRating >= 4.0) return '👍 무난하게 만족';
  return '🍽️ 한 번쯤 가볼 만함';
}

module.exports = { generateRecommendation };
