// 망원밥 v2 진입점: 스키마 적용 → 슬랙(Socket Mode) 연결 → 헬스체크 → 월간 수집
import 'dotenv/config';
import http from 'node:http';
import bolt from '@slack/bolt';
import { config } from './config.js';
import { applySchema } from './db/schema.js';
import { registerHandlers } from './slack/handlers.js';
import { startMonthlyCollect } from './collect.js';

const { App, LogLevel } = bolt;

async function main() {
  await applySchema();

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

  // Railway 헬스체크용
  http.createServer((_req, res) => { res.writeHead(200).end('ok'); }).listen(config.port);

  if (!config.disableAutoCollect) {
    startMonthlyCollect(r => console.log(`새로 생긴 곳 ${r.added}곳 (전체 ${r.total}곳)`));
  }
}

main().catch((e) => {
  console.error('시작 실패', e);
  process.exit(1);
});
