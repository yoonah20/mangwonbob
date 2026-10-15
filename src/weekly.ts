// 매주 금요일 16:30(서울) 이후 채널에 "이번 주 가 볼 만한 새 곳"을 한 번 올린다.
// 보낸 주는 DB(app_meta)에 적어서 재배포해도 두 번 보내지 않는다.
import type { App } from '@slack/bolt';
import { pool } from './db/pool.js';
import { weeklyPicks } from './picks.js';
import { weeklyView } from './slack/blocks.js';
import { config } from './config.js';
import { dueWeekKey } from './domain/schedule.js';

async function alreadySent(week: string): Promise<boolean> {
  const { rows } = await pool.query("SELECT value FROM app_meta WHERE key = 'weekly_sent'");
  return rows[0]?.value === week;
}

export async function sendWeekly(app: App, week: string): Promise<void> {
  const picks = await weeklyPicks(week);
  if (!picks.length) return;
  await app.client.chat.postMessage({
    channel: config.channelId,
    text: '이번 주 가 볼 만한 새 밥집',
    blocks: weeklyView(picks),
    unfurl_links: false,
  });
  await pool.query(
    `INSERT INTO app_meta (key, value, updated_at) VALUES ('weekly_sent', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [week]);
}

export function startWeekly(app: App): void {
  if (!config.channelId) {
    console.log('BOB_CHANNEL_ID 가 없어 주간 소식을 보내지 않습니다');
    return;
  }
  const tick = async () => {
    try {
      const week = dueWeekKey(new Date());
      if (week && !(await alreadySent(week))) await sendWeekly(app, week);
    } catch (e) {
      console.error('weekly failed', e);
    }
  };
  setInterval(tick, 10 * 60 * 1000).unref();
}
