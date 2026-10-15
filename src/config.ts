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
  googleApiKey: () => required('GOOGLE_PLACES_API_KEY'),
  hasGoogle: !!process.env.GOOGLE_PLACES_API_KEY,
  // 등급별 월 호출 상한. 무료 한도(Enterprise 1,000건)보다 조금 낮게 둔다.
  googleMonthlyLimit: Number(process.env.GOOGLE_MONTHLY_LIMIT || 900),
  slashCommand: process.env.SLASH_COMMAND || '/밥',
  // 주간 소식과 알림을 보낼 채널
  channelId: process.env.BOB_CHANNEL_ID || '',
  // 슬랙에 종류 타일 이미지를 보여 줄 때 쓰는 이 서버의 공개 주소 (예: https://mangwonbob.up.railway.app)
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
  port: Number(process.env.PORT || 3000),
  disableAutoCollect: process.env.DISABLE_AUTO_COLLECT === '1',
};
