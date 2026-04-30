// 카카오 로컬 API 연동
const axios = require('axios');

const KAKAO_LOCAL_BASE = 'https://dapi.kakao.com/v2/local';

// 회사 위치 (몬스테라하우스)
const OFFICE = {
  x: 126.9094692, // 경도
  y: 37.5548733,  // 위도
};

const CATEGORY_GROUP_CODE = 'FD6'; // 음식점

const client = axios.create({
  baseURL: KAKAO_LOCAL_BASE,
  headers: {
    Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}`,
  },
});

// 회사 반경 내 음식점 카테고리 검색 (페이지네이션)
async function searchByCategory(radius = 1000, page = 1, size = 15) {
  const { data } = await client.get('/search/category.json', {
    params: {
      category_group_code: CATEGORY_GROUP_CODE,
      x: OFFICE.x,
      y: OFFICE.y,
      radius,
      sort: 'distance',
      size,
      page,
    },
  });
  return data;
}

// is_end가 될 때까지 모든 페이지 수집
async function collectAllRestaurants(radius = 500) {
  const all = [];
  let page = 1;
  while (true) {
    const data = await searchByCategory(radius, page, 15);
    all.push(...data.documents);
    if (data.meta.is_end || page >= 45) break; // 카카오 최대 45페이지
    page += 1;
  }
  return all;
}

// 카카오 응답 → DB 스키마 매핑
function mapKakaoToRestaurant(doc) {
  // category_name 예: "음식점 > 한식 > 국밥"
  const segments = (doc.category_name || '').split('>').map(s => s.trim());
  const category = segments[1] || segments[0] || '기타';

  return {
    kakao_place_id: String(doc.id),
    name: doc.place_name,
    category,
    address: doc.address_name,
    road_address: doc.road_address_name,
    phone: doc.phone || null,
    kakao_url: doc.place_url,
    distance_from_office: doc.distance ? parseInt(doc.distance, 10) : null,
    latitude: parseFloat(doc.y),
    longitude: parseFloat(doc.x),
  };
}

module.exports = {
  OFFICE,
  searchByCategory,
  collectAllRestaurants,
  mapKakaoToRestaurant,
};
