// 구글 Places API (New). 평점과 리뷰 수만 쓴다.
// 요금 등급: 장소 찾기(searchText, id·이름·좌표) = Pro, 평점(details, rating) = Enterprise.
// 둘 다 매달 무료 한도가 있어서 sync.ts가 한도 안에서만 부른다.
import { config } from '../config.js';

const BASE = 'https://places.googleapis.com/v1';

export interface GoogleCandidate { id: string; name: string; lat: number; lng: number }

async function call(url: string, init: RequestInit, fieldMask: string): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': config.googleApiKey(),
      'X-Goog-FieldMask': fieldMask,
    },
  });
  if (!res.ok) throw new Error(`구글 Places ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function searchNear(name: string, lat: number, lng: number): Promise<GoogleCandidate[]> {
  const data = await call(`${BASE}/places:searchText`, {
    method: 'POST',
    body: JSON.stringify({
      textQuery: name,
      languageCode: 'ko',
      regionCode: 'KR',
      pageSize: 5,
      locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 200 } },
    }),
  }, 'places.id,places.displayName,places.location');
  return (data.places ?? []).map((p: any) => ({
    id: p.id, name: p.displayName?.text ?? '', lat: p.location?.latitude, lng: p.location?.longitude,
  }));
}

export async function getRating(googlePlaceId: string): Promise<{ rating: number | null; count: number | null }> {
  const data = await call(`${BASE}/places/${encodeURIComponent(googlePlaceId)}`, { method: 'GET' },
    'rating,userRatingCount');
  return { rating: data.rating ?? null, count: data.userRatingCount ?? null };
}
