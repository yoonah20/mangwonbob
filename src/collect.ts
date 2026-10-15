// 매달 한 번 주변 음식점을 다시 모은다. 새로 잡힌 곳은 "최근에 새로 생긴 곳"으로 추천에 가산점을 받는다.
import { collectAround } from './kakao/client.js';
import { upsertCollected } from './db/places.js';
import { pool } from './db/pool.js';

export async function collectOnce(): Promise<{ total: number; added: number }> {
  const docs = await collectAround();
  let added = 0;
  for (const d of docs) if (await upsertCollected(d)) added++;
  await markCollected({ total: docs.length, added });
  return { total: docs.length, added };
}

// 마지막 수집 시각은 DB에 둔다. 재배포해도 한 달에 한 번만 돈다.
async function lastCollectedAt(): Promise<Date | null> {
  const { rows } = await pool.query("SELECT updated_at FROM app_meta WHERE key = 'last_collect'");
  return rows[0]?.updated_at ?? null;
}

async function markCollected(r: { total: number; added: number }): Promise<void> {
  await pool.query(
    `INSERT INTO app_meta (key, value, updated_at) VALUES ('last_collect', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify(r)]);
}

export function startMonthlyCollect(onDone: (r: { total: number; added: number }) => void): void {
  const tick = async () => {
    try {
      const last = await lastCollectedAt();
      if (last && Date.now() - last.getTime() < 30 * 24 * 60 * 60 * 1000) return;
      const r = await collectOnce();
      console.log('monthly collect', r);
      onDone(r);
    } catch (e) {
      console.error('monthly collect failed', e);
    }
  };
  setTimeout(tick, 60 * 1000).unref();
  setInterval(tick, 6 * 60 * 60 * 1000).unref();
}
