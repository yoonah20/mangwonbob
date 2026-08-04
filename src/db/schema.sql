-- 망원밥 DB 스키마
-- PostgreSQL 14+

-- 식당 테이블 (카카오 로컬 API에서 수집)
CREATE TABLE IF NOT EXISTS restaurants (
  id SERIAL PRIMARY KEY,
  kakao_place_id VARCHAR UNIQUE NOT NULL,
  name VARCHAR NOT NULL,
  category VARCHAR,
  address VARCHAR,
  road_address VARCHAR,
  phone VARCHAR,
  kakao_url VARCHAR,
  distance_from_office INTEGER,    -- 사무실로부터의 거리(미터)
  latitude DECIMAL(10, 7),
  longitude DECIMAL(10, 7),
  hidden BOOLEAN DEFAULT FALSE,    -- 배달 전문점 등 갈 수 없는 곳 숨김
  created_at TIMESTAMP DEFAULT NOW()
);

-- 기존 테이블에도 안전하게 추가
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS hidden BOOLEAN DEFAULT FALSE;
-- 카카오 원본 카테고리 전체 경로 (예: "음식점 > 간식 > 제과,베이커리") — 세분화 버킷팅용
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS category_detail VARCHAR;
-- 사람이 수동으로 지정한 카테고리 버킷 (예: "고기") — 있으면 자동분류보다 우선
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS category_override VARCHAR;

CREATE INDEX IF NOT EXISTS idx_restaurants_category ON restaurants(category);
CREATE INDEX IF NOT EXISTS idx_restaurants_distance ON restaurants(distance_from_office);

-- 방문 기록
CREATE TABLE IF NOT EXISTS visits (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER REFERENCES restaurants(id) ON DELETE CASCADE,
  slack_user_id VARCHAR NOT NULL,
  slack_user_name VARCHAR,
  is_first_discoverer BOOLEAN DEFAULT FALSE,
  visited_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_visits_restaurant ON visits(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_visits_user ON visits(slack_user_id);
CREATE INDEX IF NOT EXISTS idx_visits_first ON visits(is_first_discoverer) WHERE is_first_discoverer = TRUE;

-- 리뷰
CREATE TABLE IF NOT EXISTS reviews (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER REFERENCES restaurants(id) ON DELETE CASCADE,
  slack_user_id VARCHAR NOT NULL,
  slack_user_name VARCHAR,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reviews_restaurant ON reviews(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_reviews_user ON reviews(slack_user_id);

-- 점심 메이트 모집 (지도에서 생성, 슬랙 채널에 공지)
CREATE TABLE IF NOT EXISTS meetups (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER REFERENCES restaurants(id) ON DELETE CASCADE,
  organizer_id VARCHAR NOT NULL,
  organizer_name VARCHAR,
  meet_at TIMESTAMP NOT NULL,         -- 약속 시간
  note TEXT,
  channel_id VARCHAR,                 -- Slack 채널 ID
  message_ts VARCHAR,                 -- Slack 메시지 ts (업데이트용)
  status VARCHAR DEFAULT 'open',      -- open / closed
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meetups_restaurant ON meetups(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_meetups_active ON meetups(status, meet_at);

-- 즐겨찾기 (개인 책갈피)
CREATE TABLE IF NOT EXISTS favorites (
  id SERIAL PRIMARY KEY,
  slack_user_id VARCHAR NOT NULL,
  restaurant_id INTEGER REFERENCES restaurants(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(slack_user_id, restaurant_id)
);
CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(slack_user_id);

-- 가고픈 곳 (하트)
CREATE TABLE IF NOT EXISTS wishlist (
  id SERIAL PRIMARY KEY,
  slack_user_id VARCHAR NOT NULL,
  restaurant_id INTEGER REFERENCES restaurants(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(slack_user_id, restaurant_id)
);
CREATE INDEX IF NOT EXISTS idx_wishlist_user ON wishlist(slack_user_id);

CREATE TABLE IF NOT EXISTS meetup_participants (
  id SERIAL PRIMARY KEY,
  meetup_id INTEGER REFERENCES meetups(id) ON DELETE CASCADE,
  slack_user_id VARCHAR NOT NULL,
  slack_user_name VARCHAR,
  joined_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(meetup_id, slack_user_id)
);
