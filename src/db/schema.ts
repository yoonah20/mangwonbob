import { pool } from './pool.js';

// 앱 시작 때마다 실행한다. 모두 IF NOT EXISTS라 여러 번 돌려도 안전하다.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS places (
  id             SERIAL PRIMARY KEY,
  kakao_place_id TEXT UNIQUE NOT NULL,
  name           TEXT NOT NULL,
  category_path  TEXT,
  kind_override  TEXT,
  address        TEXT,
  road_address   TEXT,
  phone          TEXT,
  kakao_url      TEXT,
  lat            DOUBLE PRECISION,
  lng            DOUBLE PRECISION,
  distance_m     INT,
  source         TEXT NOT NULL DEFAULT 'collect' CHECK (source IN ('legacy', 'collect', 'manual')),
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  hidden         BOOLEAN NOT NULL DEFAULT FALSE
);
-- 구글 평점. 구글 약관상 평점은 30일 안에 다시 받아야 해서 checked_at으로 갱신 시점을 잡는다.
ALTER TABLE places ADD COLUMN IF NOT EXISTS google_place_id     TEXT;
ALTER TABLE places ADD COLUMN IF NOT EXISTS google_rating       REAL;
ALTER TABLE places ADD COLUMN IF NOT EXISTS google_rating_count INT;
ALTER TABLE places ADD COLUMN IF NOT EXISTS google_checked_at   TIMESTAMPTZ;
ALTER TABLE places ADD COLUMN IF NOT EXISTS google_match_failed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS visits (
  id            SERIAL PRIMARY KEY,
  place_id      INT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  slack_user_id TEXT NOT NULL,
  user_name     TEXT,
  visited_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  source        TEXT NOT NULL DEFAULT 'outing'
);
CREATE INDEX IF NOT EXISTS visits_place_idx ON visits(place_id);

-- verdict: 1 = 또 갈래, 0 = 무난, -1 = 별로
CREATE TABLE IF NOT EXISTS ratings (
  id            SERIAL PRIMARY KEY,
  place_id      INT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  slack_user_id TEXT NOT NULL,
  user_name     TEXT,
  verdict       SMALLINT NOT NULL CHECK (verdict IN (-1, 0, 1)),
  comment       TEXT,
  legacy_stars  SMALLINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ratings_place_idx ON ratings(place_id);

CREATE TABLE IF NOT EXISTS wishes (
  slack_user_id TEXT NOT NULL,
  place_id      INT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (slack_user_id, place_id)
);

CREATE TABLE IF NOT EXISTS app_meta (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 하루 한 번 정하는 "오늘의 추천". 모두가 같은 걸 본다.
CREATE TABLE IF NOT EXISTS daily_picks (
  day      DATE NOT NULL,
  slot     SMALLINT NOT NULL,
  place_id INT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  reason   TEXT NOT NULL,
  PRIMARY KEY (day, slot)
);
`;

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA);
}
