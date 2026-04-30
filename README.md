# 🍚 망원밥 — 슬랙 식당 탐험 RPG 봇
*by 몬스테라하우스*

서울 마포구 망원동 몬스테라하우스 직원들을 위한 회사 근처 식당 탐험 슬랙 봇.
처음 가는 동네를 RPG처럼 하나씩 탐험하며, 직원들이 직접 리뷰와 별점을 남겨가며
"우리 동네 맛집 지도"를 함께 만들어 갑니다.

---

## ✨ 핵심 컨셉

- **🌫️ UNKNOWN** — 아무도 가본 적 없는 미탐험 식당. 이름/카테고리/거리만 노출.
- **✅ DISCOVERED** — 1명 이상 방문한 식당. 별점/리뷰/방문자 전부 공개.
- **🏴 첫 발견자** — 가장 먼저 간 사람에게 영구 표시. 채널에 공지됨.
- **👑 단골** — 같은 식당 3회 이상 방문 시 단골 뱃지.

---

## 🧩 기술 스택

- Node.js 18+ / Express
- Slack Bolt SDK (Socket Mode 권장)
- PostgreSQL
- Kakao 로컬 API (FD6 음식점 카테고리)
- DeepSeek API (`deepseek-chat`) — 추천 코멘트 생성
- Railway 배포

---

## 🗂️ 프로젝트 구조

```
/src
  /handlers
    commands.js      # 슬래시 커맨드 라우팅 + 버튼 액션
    modals.js        # 리뷰 작성 Modal 처리
  /services
    kakao.js         # 카카오 로컬 API 연동
    deepseek.js      # DeepSeek 추천 코멘트
    restaurant.js    # 식당 조회/상태 관리
    review.js        # 방문/리뷰 기록
    ranking.js       # 탐험 순위 집계
  /db
    schema.sql       # 테이블 정의
    queries.js       # PG 쿼리 모음
  /utils
    blocks.js        # Slack Block Kit 빌더
    format.js        # 포맷 헬퍼
  app.js             # 메인 서버
/scripts
  collect-restaurants.js   # 카카오 데이터 수집
```

---

## 🚀 빠른 시작

### 1. 의존성 설치
```bash
npm install
```

### 2. 환경변수 설정
`.env.example` 을 복사해 `.env` 파일을 만들고 값을 채워넣어주세요.
```bash
cp .env.example .env
```

### 3. DB 초기화
```bash
npm run init-db
```
또는 PostgreSQL에 직접 `src/db/schema.sql` 실행.

### 4. 식당 데이터 수집
```bash
npm run collect
```
회사 위치(서울 마포구 월드컵로13길 19-25) 반경 1km 내 음식점을 모두 수집합니다.

### 5. 서버 실행
```bash
npm start
# 또는 개발 모드 (변경 시 자동 재시작)
npm run dev
```

---

## 🔧 카카오 Developers 키 발급

1. <https://developers.kakao.com> 접속 → 로그인
2. **내 애플리케이션** → **애플리케이션 추가하기**
   - 앱 이름: `망원밥` (자유)
   - 회사명: `몬스테라하우스`
3. 생성된 앱 → **앱 키** 탭에서 **REST API 키** 복사 → `.env` 의 `KAKAO_REST_API_KEY` 에 붙여넣기
4. **플랫폼 설정**은 서버 사용 시 별도 설정 불필요 (REST API 키만 있으면 호출 가능)

> 카카오 로컬 API 무료 한도: 1일 100,000회 (충분)

---

## 🤖 DeepSeek API 키 발급

1. <https://platform.deepseek.com> 접속 → 회원가입/로그인
2. **API Keys** 메뉴에서 **Create new API key**
3. 발급된 키를 `.env` 의 `DEEPSEEK_API_KEY` 에 붙여넣기
4. (선택) 다른 모델 사용 시 `DEEPSEEK_MODEL` 로 오버라이드 (기본값 `deepseek-chat`)

> DeepSeek은 OpenAI 호환 인터페이스라 별도 SDK 없이 `axios` 로 호출합니다.
> 키가 없으면 별점 기반 폴백 코멘트로 동작하므로 봇 자체는 그대로 작동합니다.

---

## 💬 Slack App 생성

### 1. Slack App 만들기
1. <https://api.slack.com/apps> → **Create New App** → **From scratch**
2. 앱 이름: `망원밥`, 설치할 워크스페이스 선택

### 2. Slash Command 등록
- **Slash Commands** → **Create New Command**
  - Command: `/밥`
  - Request URL: (Socket Mode 사용 시 빈 값 가능 / HTTP 모드면 `https://your-domain/slack/events`)
  - Short Description: `오늘의 망원밥 추천`
  - Usage Hint: `[카테고리] | 방문 [식당명] | 리뷰 [식당명] | 탐험 | 지도`

### 3. Bot Token Scopes
**OAuth & Permissions** → **Scopes** → **Bot Token Scopes**:
- `chat:write`
- `commands`
- `users:read`
- `im:write` (리뷰 확인 DM용)

### 4. Interactivity & Shortcuts (Modal용)
- **Interactivity & Shortcuts** → **Interactivity** ON
- (Socket Mode면 Request URL 불필요)

### 5. Socket Mode 활성화 (권장)
- **Socket Mode** → **Enable Socket Mode** ON
- App-Level Token 생성 (`connections:write` 스코프)
- 발급된 토큰을 `.env` 의 `SLACK_APP_TOKEN` (`xapp-...`) 에 입력

### 6. 워크스페이스에 설치
- **Install App** → **Install to Workspace**
- 발급된 Bot Token (`xoxb-...`) → `.env` 의 `SLACK_BOT_TOKEN`
- **Basic Information** → Signing Secret → `.env` 의 `SLACK_SIGNING_SECRET`

---

## 🚂 Railway 배포

1. <https://railway.app> 로그인 → **New Project** → **Deploy from GitHub repo**
2. 이 저장소 선택
3. **+ New** → **Database** → **PostgreSQL** 추가 (자동으로 `DATABASE_URL` 주입됨)
4. 프로젝트 **Variables** 에 환경변수 추가:
   - `SLACK_BOT_TOKEN`
   - `SLACK_SIGNING_SECRET`
   - `SLACK_APP_TOKEN`
   - `KAKAO_REST_API_KEY`
   - `DEEPSEEK_API_KEY`
5. 첫 배포 후 한 번만 실행:
   ```bash
   # Railway 셸(또는 로컬에서 DATABASE_URL을 export 한 뒤)
   npm run init-db
   npm run collect
   ```
6. Slack 워크스페이스에서 `/밥` 입력 → 끝!

---

## 🎮 슬랙 커맨드

| 명령어 | 설명 |
|---|---|
| `/밥` | 팀 탐험 현황 + 오늘의 추천 식당 3곳 |
| `/밥 한식` | 카테고리 필터 (한식/일식/중식/양식/카페/분식 등) |
| `/밥 방문 할매국밥` | 방문 기록. 첫 발견이면 채널에 공지 + 리뷰 모달 안내 |
| `/밥 리뷰 할매국밥` | 리뷰 작성 모달 (별점/코멘트/태그) |
| `/밥 탐험` | 내 개인 탐험 현황 + 단골 + 팀 내 순위 |
| `/밥 지도` | 팀 전체 탐험 현황 + 탐험왕/첫발견왕/단골왕 |

---

## 🌿 기획/디자인 노트

- 팀 동기부여를 위해 첫 발견 알림은 **채널 공개**, 그 외는 ephemeral.
- 미탐험 식당은 정보를 의도적으로 가려서 "탐험 동기"를 만든다.
- DeepSeek의 추천 코멘트는 30자 이내 짧고 친근한 톤으로 고정.
- 모든 메시지 푸터에 `🌿 망원밥 by 몬스테라하우스` 브랜딩 유지.
