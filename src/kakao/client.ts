// 카카오 로컬 API로 회사 주변 음식점(FD6)을 모은다. 저녁 추천용이라 카페(CE7)는 모으지 않는다.
import { config } from '../config.js';
import type { KakaoPlace } from '../db/places.js';

export const OFFICE = { lat: 37.5548733, lng: 126.9094692 }; // 몬스테라하우스
// 레거시와 같은 두 중심점: 회사, 망원파출소 근처
export const CENTERS = [OFFICE, { lat: 37.5563, lng: 126.9019 }];

interface KakaoDoc {
  id: string; place_name: string; category_name: string; address_name: string;
  road_address_name: string; phone: string; place_url: string; x: string; y: string;
}

export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000, rad = (d: number) => d * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function searchCategory(lat: number, lng: number, radius: number, page: number) {
  const url = new URL('https://dapi.kakao.com/v2/local/search/category.json');
  url.search = new URLSearchParams({ category_group_code: 'FD6', x: String(lng), y: String(lat),
    radius: String(radius), sort: 'distance', size: '15', page: String(page) }).toString();
  const res = await fetch(url, { headers: { Authorization: `KakaoAK ${config.kakaoRestKey()}` } });
  if (!res.ok) throw new Error(`카카오 API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<{ documents: KakaoDoc[]; meta: { is_end: boolean } }>;
}

// 카카오는 한 검색에 45곳까지만 주므로 3x3 격자로 나눠 훑는다
export async function collectAround(radius = 500): Promise<KakaoPlace[]> {
  const found = new Map<string, KakaoPlace>();
  for (const c of CENTERS) {
    const step = radius / 2;
    const dLat = step / 111000, dLng = step / (111000 * Math.cos(c.lat * Math.PI / 180));
    for (const dy of [-1, 0, 1]) for (const dx of [-1, 0, 1]) {
      const p = { lat: c.lat + dy * dLat, lng: c.lng + dx * dLng };
      for (let page = 1; page <= 3; page++) {
        const data = await searchCategory(p.lat, p.lng, Math.ceil(radius * 0.75), page);
        for (const d of data.documents) {
          const pos = { lat: Number(d.y), lng: Number(d.x) };
          if (haversineM(c, pos) > radius || found.has(d.id)) continue;
          found.set(d.id, {
            kakaoPlaceId: d.id, name: d.place_name, categoryPath: d.category_name || null,
            address: d.address_name || null, roadAddress: d.road_address_name || null,
            phone: d.phone || null, kakaoUrl: d.place_url || null, ...pos,
            distanceM: Math.round(haversineM(OFFICE, pos)),
          });
        }
        if (data.meta.is_end) break;
      }
    }
  }
  return [...found.values()];
}
