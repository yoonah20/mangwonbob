import pg from 'pg';
import { config } from '../config.js';

// TIMESTAMPTZ는 Date, DATE는 'YYYY-MM-DD' 문자열 그대로 받는다
pg.types.setTypeParser(1082, (v: string) => v);

export const pool = new pg.Pool({ connectionString: config.databaseUrl(), max: 5 });
