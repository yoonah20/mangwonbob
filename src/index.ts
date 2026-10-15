// 망원밥 v2 진입점: 스키마 적용 → 슬랙(Socket Mode) 연결 → 웹(헬스체크·타일 이미지) → 예약 작업
import 'dotenv/config';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bolt from '@slack/bolt';
import { config } from './config.js';
import { applySchema } from './db/schema.js';
import { registerHandlers } from './slack/handlers.js';
import { startMonthlyCollect } from './collect.js';
import { syncGoogle } from './google/sync.js';
import { startWeekly } from './weekly.js';

const { App, LogLevel } = bolt;
const TILES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'tiles');

function startWeb(): void {
  http.createServer(async (req, res) => {
    const m = req.url?.match(/^\/tiles\/([a-z]+)\.png$/);
    if (m) {
      try {
        const png = await readFile(path.join(TILES_DIR, `${m[1]}.png`));
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800' }).end(png);
      } catch {
        res.writeHead(404).end();
      }
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('망원밥 v2 ok');
  }).listen(config.port, () => console.log(`웹 서버 :${config.port}`));
}

async function runGoogleSync(): Promise<void> {
  if (!config.hasGoogle) return;
  try {
    await syncGoogle();
  } catch (e) {
    console.error('google sync failed', e);
  }
}

async function main() {
  await applySchema();
  startWeb();

  const app = new App({
    token: config.slackBotToken(),
    appToken: config.slackAppToken(),
    socketMode: true,
    logLevel: LogLevel.INFO,
  });
  registerHandlers(app);
  app.error(async (e) => { console.error('bolt error', e); });
  await app.start();
  console.log(`망원밥 v2 실행 중 · 명령어 ${config.slashCommand}`);

  // 구글 평점: 시작 직후 한 번, 이후 하루 한 번 (한도와 25일 갱신 주기는 sync가 알아서 지킨다)
  setTimeout(runGoogleSync, 30 * 1000).unref();
  setInterval(runGoogleSync, 24 * 60 * 60 * 1000).unref();

  if (!config.disableAutoCollect) {
    startMonthlyCollect(r => {
      console.log(`새로 생긴 곳 ${r.added}곳 (전체 ${r.total}곳)`);
      void runGoogleSync();
    });
  }
  startWeekly(app);
}

main().catch((e) => {
  console.error('시작 실패', e);
  process.exit(1);
});
