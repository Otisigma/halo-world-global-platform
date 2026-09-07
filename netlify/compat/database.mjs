/**
 * @netlify/database compat shim
 *
 * Replaces the Netlify managed Postgres client with a standard `pg` Pool.
 * Env var: DATABASE_URL (******host:5432/dbname)
 *
 * The shim surfaces the same minimal API used across all Netlify Functions
 * in this repository:
 *   const db = getDatabase() / await getDatabase()
 *   await db.query(sql, params?)   → { rows: [...] }
 */

import pg from "pg";

const { Pool } = pg;

let _pool = null;

function getPool() {
  if (!_pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is not set");
    }
    _pool = new Pool({ connectionString, max: 10 });
    _pool.on("error", (err) => {
      console.error("[db] idle client error", err.message);
    });
  }
  return _pool;
}

export function getDatabase() {
  const pool = getPool();
  return {
    query: (text, params) => pool.query(text, params),
    /** Convenience: run a callback inside a single transaction */
    transaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

/** Expose underlying pool for health checks */
export function getDatabasePool() {
  return getPool();
}
