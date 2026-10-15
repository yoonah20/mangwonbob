// 기존(v1) DB에서 v2 DB로 데이터를 옮긴다. 한 번만 돌리면 된다.
//   LEGACY_DATABASE_URL=<기존 DB> DATABASE_URL=<새 DB> npm run import-legacy
// 새 DB에 이미 장소가 있으면 멈춘다. 지우고 다시 하려면 --force.
//
// 옮기는 것: 식당 전체(숨김 여부 포함), 방문, 리뷰(별점 → 또 갈래/무난/별로), 가고픈 곳·즐겨찾기(→ 찜)
// 버리는 것: 점심 모집, 리뷰 태그
import 'dotenv/config';
import pg from 'pg';
import { pool } from '../db/pool.js';
import { applySchema } from '../db/schema.js';

const OLD_BUCKET_TO_KIND: Record<string, string> = {
  빵집: '빵·간식', 카페: '카페', 일식: '일식', 중식: '중식', 양식: '양식', 해산물: '해산물',
  술집: '술집', 분식: '분식', 치킨: '치킨', 고기: '고기', 아시아: '아시아', 한식: '한식', 기타: '기타',
};

export function starsToVerdict(stars: number): -1 | 0 | 1 {
  if (stars >= 4) return 1;
  if (stars <= 2) return -1;
  return 0;
}

async function main() {
  const legacyUrl = process.env.LEGACY_DATABASE_URL;
  if (!legacyUrl) throw new Error('LEGACY_DATABASE_URL 을 기존 DB 주소로 설정하세요.');
  const force = process.argv.includes('--force');
  const old = new pg.Client({ connectionString: legacyUrl });
  await old.connect();
  await applySchema();

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows: [{ n }] } = await db.query('SELECT COUNT(*)::int AS n FROM places');
    if (n > 0) {
      if (!force) throw new Error(`새 DB에 이미 장소가 ${n}곳 있습니다. 지우고 다시 하려면 --force 를 붙이세요.`);
      await db.query('TRUNCATE places, visits, ratings, wishes, daily_picks RESTART IDENTITY CASCADE');
    }

    const idMap = new Map<number, number>();
    const { rows: rs } = await old.query('SELECT * FROM restaurants ORDER BY id');
    for (const r of rs) {
      const path = r.category_detail ?? (r.category ? `음식점 > ${r.category}` : null);
      const { rows: [row] } = await db.query(`
        INSERT INTO places (kakao_place_id, name, category_path, kind_override, address, road_address, phone,
                            kakao_url, lat, lng, distance_m, source, first_seen_at, hidden)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'legacy',$12,$13) RETURNING id`,
        [r.kakao_place_id, r.name, path, r.category_override ? OLD_BUCKET_TO_KIND[r.category_override] ?? null : null,
          r.address, r.road_address, r.phone, r.kakao_url, r.latitude, r.longitude, r.distance_from_office,
          r.created_at, r.hidden ?? false]);
      idMap.set(r.id, row.id);
    }

    const { rows: vs } = await old.query('SELECT * FROM visits ORDER BY id');
    for (const v of vs) {
      await db.query(
        `INSERT INTO visits (place_id, slack_user_id, user_name, visited_at, source) VALUES ($1,$2,$3,$4,'legacy')`,
        [idMap.get(v.restaurant_id), v.slack_user_id, v.slack_user_name, v.visited_at]);
    }

    const { rows: rv } = await old.query('SELECT * FROM reviews ORDER BY id');
    for (const r of rv) {
      await db.query(
        `INSERT INTO ratings (place_id, slack_user_id, user_name, verdict, comment, legacy_stars, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [idMap.get(r.restaurant_id), r.slack_user_id, r.slack_user_name, starsToVerdict(r.rating),
          r.comment || null, r.rating, r.created_at]);
    }

    let wishes = 0;
    for (const table of ['wishlist', 'favorites']) {
      const { rows } = await old.query(`SELECT slack_user_id, restaurant_id, created_at FROM ${table}`);
      for (const w of rows) {
        const res = await db.query(
          `INSERT INTO wishes (slack_user_id, place_id, created_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [w.slack_user_id, idMap.get(w.restaurant_id), w.created_at]);
        wishes += res.rowCount ?? 0;
      }
    }

    await db.query('COMMIT');
    console.log(`옮김: 장소 ${rs.length}, 방문 ${vs.length}, 평가 ${rv.length}, 찜 ${wishes}`);
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
    await old.end();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
