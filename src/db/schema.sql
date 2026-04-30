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
  created_at TIMESTAMP DEFAULT NOW()
);

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
