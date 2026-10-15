// 환경변수는 여기서만 읽는다.
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`환경변수 ${name} 이(가) 비어 있습니다. .env.example 을 참고하세요.`);
  return v;
}

export const config = {
  databaseUrl: () => required('DATABASE_URL'),
  slackBotToken: () => required('SLACK_BOT_TOKEN'),
  slackAppToken: () => required('SLACK_APP_TOKEN'),
  kakaoRestKey: () => required('KAKAO_REST_API_KEY'),
  slashCommand: process.env.SLASH_COMMAND || '/뭐먹지',
  port: Number(process.env.PORT || 3000),
  disableAutoCollect: process.env.DISABLE_AUTO_COLLECT === '1',
};
