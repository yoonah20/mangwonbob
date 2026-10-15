// 카카오 수집과 구글 평점 동기화를 지금 한 번 돌린다.
//   npm run collect            # 카카오 수집 + 구글 동기화
//   npm run collect -- --google-only
import 'dotenv/config';
import { applySchema } from '../db/schema.js';
import { collectOnce } from '../collect.js';
import { syncGoogle } from '../google/sync.js';
import { pool } from '../db/pool.js';
import { config } from '../config.js';

async function main() {
  await applySchema();
  if (!process.argv.includes('--google-only')) console.log('카카오 수집', await collectOnce());
  if (config.hasGoogle) await syncGoogle();
  else console.log('GOOGLE_PLACES_API_KEY 가 없어 구글 평점은 건너뜁니다');
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
