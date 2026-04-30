// schema.sql을 Node에서 직접 실행 (psql 없는 환경용)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/db/queries');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL이 .env에 설정돼 있지 않습니다.');
    process.exit(1);
  }
  const sql = fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8');
  console.log('🛠️  스키마 적용 중...');
  await pool.query(sql);
  console.log('✅ 테이블 생성 완료');
  await pool.end();
}

main().catch((e) => {
  console.error('💥 스키마 적용 실패:', e);
  process.exit(1);
});
