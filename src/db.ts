// src/db.ts
import 'dotenv/config';
import pg from 'pg';
const { Pool, types } = pg;

// ===== Parsers (evita strings donde esperas números/fechas) =====
types.setTypeParser(20,   (val: string) => parseInt(val, 10)); // int8
types.setTypeParser(1700, (val: string) => parseFloat(val));   // numeric
types.setTypeParser(1184, (val: string) => new Date(val));     // timestamptz → Date

// ===== Config por URL o por variables sueltas =====
const hasUrl = !!process.env.DATABASE_URL;

const baseConfig: pg.PoolConfig = hasUrl
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'true'
        ? { rejectUnauthorized: false } // útil en Neon/Render/Heroku
        : undefined,
    }
  : {
      host: process.env.PGHOST || 'localhost',
      port: Number(process.env.PGPORT || 5432),
      database: process.env.PGDATABASE || 'buscadog',
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || '',
    };

// ===== Ajustes de pool/timeout seguros =====
export const pool = new Pool({
  ...baseConfig,
  max: Number(process.env.PGPOOL_MAX || 10),
  idleTimeoutMillis: Number(process.env.PG_IDLE || 10_000),
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT || 5_000),
});

pool.on('connect', () => console.log('[pg] connect'));
pool.on('remove',  () => console.log('[pg] remove'));
pool.on('error',   (err) => console.error('[pg] pool error', err));

// ===== Helper de query simple =====
export async function dbQuery<T = any>(text: string, params: any[] = []) {
  const { rows } = await pool.query<T>(text, params);
  return rows;
}

// ===== Helper de transacción =====
export async function dbTx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ret = await fn(client);
    await client.query('COMMIT');
    return ret;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ===== Healthcheck de BD =====
export async function dbHealth() {
  const [{ now }] = await dbQuery<{ now: Date }>('SELECT now() as now');
  return { ok: true, now };
}

// ===== Cierre ordenado =====
process.on('SIGINT', async () => {
  console.log('[pg] SIGINT → pool.end()');
  await pool.end();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  console.log('[pg] SIGTERM → pool.end()');
  await pool.end();
  process.exit(0);
});
