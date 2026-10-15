// 종류 타일 이미지. 슬랙 이미지 블록은 공개 URL만 받아서, PUBLIC_URL이 있을 때만 쓴다.
// 이미지는 assets/tiles/*.png (scripts/render-tiles.sh 로 만든다)이고 index.ts가 /tiles/ 로 내보낸다.
import type { Kind } from '../domain/kinds.js';
import { config } from '../config.js';

export const KIND_TILES: Record<Kind, { slug: string; bg: string; fg: string }> = {
  고기: { slug: 'meat', bg: '#B5502A', fg: '#FBF8F2' },
  한식: { slug: 'korean', bg: '#8C6A3A', fg: '#FBF8F2' },
  일식: { slug: 'japanese', bg: '#2F5D86', fg: '#FBF8F2' },
  중식: { slug: 'chinese', bg: '#9B2C2C', fg: '#FBF8F2' },
  양식: { slug: 'western', bg: '#4C6B2F', fg: '#FBF8F2' },
  아시아: { slug: 'asian', bg: '#1F6E68', fg: '#FBF8F2' },
  해산물: { slug: 'seafood', bg: '#2C4A9A', fg: '#FBF8F2' },
  술집: { slug: 'bar', bg: '#5E3A8C', fg: '#FBF8F2' },
  분식: { slug: 'snack', bg: '#B8862B', fg: '#141A24' },
  치킨: { slug: 'chicken', bg: '#C9761A', fg: '#141A24' },
  카페: { slug: 'cafe', bg: '#6B5444', fg: '#FBF8F2' },
  '빵·간식': { slug: 'bakery', bg: '#A0784A', fg: '#FBF8F2' },
  기타: { slug: 'etc', bg: '#4A5566', fg: '#FBF8F2' },
};

export function kindTileUrl(kind: Kind): string | null {
  if (!config.publicUrl) return null;
  return `${config.publicUrl}/tiles/${KIND_TILES[kind].slug}.png`;
}
