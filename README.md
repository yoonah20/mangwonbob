# 망원밥 v2

몬스테라하우스 근처에서 **우리 중 아무도 안 가 본 저녁 밥집**을 골라 주는 슬랙 앱.
익숙한 곳은 알아서 가고, 새로 갈 곳을 찾을 때 씁니다.

- `/밥` → 오늘 가 볼 만한 새 밥집 세 곳 (모두에게 같은 "오늘의 추천", 다시 뽑기·기분 버튼으로 바꿔 보기)
- 각 가게 ⋯ 메뉴 → **가 봤어요(또 갈래/무난/별로)**, 찜하기, 추천에서 빼기
- 매주 금요일 16:30 → 채널에 "이번 주 가 볼 만한 새 밥집" 세 곳

## 추천은 어떻게 고르나

`src/domain/recommend.ts` (테스트: `recommend.test.ts`)

- 후보: 카카오로 모은 회사 주변 음식점 중 **방문·평가 기록이 없는 곳**. 카페·빵집, 포장·배달 전문, 800m 밖, 숨긴 곳은 제외
- 점수에 더하는 것: 구글 평점(리뷰 수가 적으면 덜 믿음), 우리가 '또 갈래'를 많이 준 종류, 우리가 아직 안 가 본 종류, 최근에 새로 생긴 곳(월간 수집에서 처음 잡힌 곳), 누가 찜한 곳
- 점수에서 빼는 것: 체인점, 먼 거리, 최근 7일 안에 오늘의 추천에 나온 곳
- 점수 비례로 무작위 추첨하고, 세 곳은 가능한 한 서로 다른 종류로

## 데이터

| 출처 | 쓰는 것 | 주기 |
|---|---|---|
| 카카오 로컬 API | 회사·망원파출소 반경 500m 음식점 | 매달 자동 (`app_meta.last_collect`) |
| 구글 Places API (New) | 평점·리뷰 수 | 매일 확인, 25일 지난 것만 갱신 (구글 약관상 30일 안에 갱신, 넘으면 지움) |

구글 호출은 등급별로 월 `GOOGLE_MONTHLY_LIMIT`(기본 900)건까지만 합니다. 장소 짝짓기(searchText, Pro 등급)와 평점(details, Enterprise 등급) 모두 무료 한도 안입니다.

## 처음 설치

1. **슬랙 앱** — api.slack.com/apps → Create New App → From a manifest → `slack-manifest.yml` 붙여 넣기.
   Socket Mode의 App-Level Token(`connections:write`)과 Bot Token을 발급합니다.
   기존 v1 앱이 `/밥`을 쓰고 있다면 시험하는 동안 매니페스트와 `SLASH_COMMAND`를 `/밥2`처럼 바꿔 두세요.
2. **구글 Places API 키** — Google Cloud 콘솔에서 프로젝트 생성 → 결제 계정 연결 → "Places API (New)" 사용 설정 → API 키 발급(Places API (New)만 허용하도록 제한 권장).
3. **Railway** — 새 서비스(이 저장소의 `v2` 브랜치) + 새 Postgres. `.env.example` 의 값을 Variables에 넣습니다. 공개 도메인을 만들어 `PUBLIC_URL`에 넣으면 카드에 종류 타일 이미지가 붙습니다.
4. **기존 데이터 옮기기** — Railway 셸에서 한 번:
   ```bash
   LEGACY_DATABASE_URL=<기존 DB 주소> npm run import-legacy
   ```
   식당 869곳, 방문, 리뷰(4~5점 → 또 갈래, 3점 → 무난, 1~2점 → 별로), 가고픈 곳·즐겨찾기(→ 찜)를 옮깁니다.
5. 구글 평점은 앱이 켜지고 30초 뒤 자동으로 받기 시작합니다. 바로 돌리려면 `npm run collect -- --google-only`.

## 개발

```bash
npm install
cp .env.example .env   # 값 채우기
npm run dev            # tsx watch
npm test               # 순수 로직 테스트 (DB·슬랙 불필요)
npm run typecheck
```

```
src/
  domain/      순수 로직: 종류 분류(kinds), 추천 점수(recommend), 카카오↔구글 이름 짝짓기(match), 주간 소식 시각(schedule)
  db/          스키마(앱 시작 때 자동 적용)와 쿼리
  slack/       Block Kit 화면(blocks), 버튼 처리(handlers), 종류 타일(tiles)
  kakao/       카카오 로컬 API 수집
  google/      구글 Places 호출과 평점 동기화
  picks.ts     오늘의 추천·다시 뽑기·주간 추천
  weekly.ts    주간 소식 발송
  collect.ts   월간 카카오 수집
  scripts/     import-legacy, collect
assets/tiles/  종류 타일 PNG (`npm run render-tiles` 로 다시 생성)
docs/          리뉴얼 기획안
```
