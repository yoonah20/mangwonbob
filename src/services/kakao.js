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

// 임의 좌표 + 반경으로 카테고리 검색 (페이지네이션)
async function searchByCategoryAt({ x, y }, radius, page = 1, size = 15) {
  const { data } = await client.get('/search/category.json', {
    params: {
      category_group_code: CATEGORY_GROUP_CODE,
      x, y, radius, sort: 'distance', size, page,
    },
  });
  return data;
}

// Haversine 공식 — 두 좌표 사이 거리(m)
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// 회사 반경 내 음식점 수집 — 카카오 카테고리 API의 45개 제한 회피를 위해
// 3x3 그리드로 9개 지점에서 각각 검색 후 중복 제거
async function collectAllRestaurants(radius = 500) {
  const all = new Map();

  // 그리드 격자 간격 (반경의 절반)
  const step = radius / 2;
  // 위도/경도 1m당 도(degree)
  const mPerLat = 1 / 111000;
  const mPerLng = 1 / (111000 * Math.cos(OFFICE.y * Math.PI / 180));
  // 각 지점 검색 반경 (살짝 겹쳐서 누락 방지)
  const subRadius = Math.ceil(radius * 0.75);

  const points = [];
  for (const dy of [-1, 0, 1]) {
    for (const dx of [-1, 0, 1]) {
      points.push({
        x: OFFICE.x + dx * step * mPerLng,
        y: OFFICE.y + dy * step * mPerLat,
      });
    }
  }

  for (const point of points) {
    let page = 1;
    while (true) {
      const data = await searchByCategoryAt(point, subRadius, page, 15);
      for (const doc of data.documents) {
        // 회사로부터 실제 거리 재계산
        const dist = haversine(OFFICE.y, OFFICE.x, parseFloat(doc.y), parseFloat(doc.x));
        if (dist > radius) continue;
        // 중복 제거 + 정확한 거리 갱신
        if (!all.has(doc.id)) {
          all.set(doc.id, { ...doc, _distFromOffice: Math.round(dist) });
        }
      }
      if (data.meta.is_end || page >= 45) break;
      page += 1;
    }
  }

  return Array.from(all.values());
}

// 카카오 응답 → DB 스키마 매핑
function mapKakaoToRestaurant(doc) {
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
    distance_from_office: doc._distFromOffice ?? (doc.distance ? parseInt(doc.distance, 10) : null),
    latitude: parseFloat(doc.y),
    longitude: parseFloat(doc.x),
  };
}

module.exports = {
  OFFICE,
  searchByCategoryAt,
  collectAllRestaurants,
  mapKakaoToRestaurant,
  haversine,
};
