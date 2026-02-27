import pg from 'pg';
import { config } from '../config.js';

const pool = new pg.Pool({
  connectionString: config.database.url,
});

pool.on('error', (err) => {
  console.error('Unexpected DB pool error', err);
});

export { pool };

export async function query<T extends pg.QueryResultRow>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const result = await pool.query<T>(sql, params);
  return result.rows;
}

export async function queryOne<T extends pg.QueryResultRow>(
  sql: string,
  params?: unknown[]
): Promise<T | null> {
  const result = await pool.query<T>(sql, params);
  return result.rows[0] ?? null;
}
