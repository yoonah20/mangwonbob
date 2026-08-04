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

// 키워드로 장소 좌표 찾기 (예: "망원파출소")
async function findLocationByKeyword(keyword) {
  const { data } = await client.get('/search/keyword.json', {
    params: { query: keyword, size: 1 },
  });
  if (!data.documents || !data.documents.length) return null;
  const doc = data.documents[0];
  return {
    x: parseFloat(doc.x),
    y: parseFloat(doc.y),
    name: doc.place_name,
    address: doc.address_name,
  };
}

// 키워드로 음식점 검색 (수동 추가용 — 회사 반경 2km 내, FD6 카테고리)
async function searchFoodByKeyword(query, { radius = 2000, size = 10 } = {}) {
  const { data } = await client.get('/search/keyword.json', {
    params: {
      query, x: OFFICE.x, y: OFFICE.y, radius, sort: 'distance', size,
      category_group_code: CATEGORY_GROUP_CODE,
    },
  });
  return data.documents || [];
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

// 한 중심점 + 반경 내 식당 수집 (3x3 그리드로 카카오 45개 제한 회피)
async function collectAroundCenter(center, radius) {
  const found = new Map();
  const step = radius / 2;
  const mPerLat = 1 / 111000;
  const mPerLng = 1 / (111000 * Math.cos(center.y * Math.PI / 180));
  const subRadius = Math.ceil(radius * 0.75);

  const points = [];
  for (const dy of [-1, 0, 1]) {
    for (const dx of [-1, 0, 1]) {
      points.push({
        x: center.x + dx * step * mPerLng,
        y: center.y + dy * step * mPerLat,
      });
    }
  }

  for (const point of points) {
    let page = 1;
    while (true) {
      const data = await searchByCategoryAt(point, subRadius, page, 15);
      for (const doc of data.documents) {
        const dist = haversine(center.y, center.x, parseFloat(doc.y), parseFloat(doc.x));
        if (dist > radius) continue;
        if (!found.has(doc.id)) {
          found.set(doc.id, { ...doc, _distFromCenter: Math.round(dist) });
        }
      }
      if (data.meta.is_end || page >= 45) break;
      page += 1;
    }
  }
  return Array.from(found.values());
}

// 여러 중심점에서 반경 내 식당 수집 후 중복 제거
// (회사로부터의 거리는 항상 OFFICE 기준으로 재계산)
async function collectAllRestaurants(radius = 500, centers = [OFFICE]) {
  const merged = new Map();
  for (const center of centers) {
    const docs = await collectAroundCenter(center, radius);
    for (const doc of docs) {
      if (!merged.has(doc.id)) {
        const dist = haversine(OFFICE.y, OFFICE.x, parseFloat(doc.y), parseFloat(doc.x));
        merged.set(doc.id, { ...doc, _distFromOffice: Math.round(dist) });
      }
    }
  }
  return Array.from(merged.values());
}

// 카카오 응답 → DB 스키마 매핑
function mapKakaoToRestaurant(doc) {
  const segments = (doc.category_name || '').split('>').map(s => s.trim());
  const category = segments[1] || segments[0] || '기타';

  return {
    kakao_place_id: String(doc.id),
    name: doc.place_name,
    category,
    category_detail: doc.category_name || null,  // 전체 경로 — 지도 세분화용
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
  findLocationByKeyword,
  searchFoodByKeyword,
  collectAllRestaurants,
  collectAroundCenter,
  mapKakaoToRestaurant,
  haversine,
};
