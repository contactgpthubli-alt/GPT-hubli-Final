import { Pool } from "pg"

// Portable Postgres pool: works on Neon (dev/preview) and vanilla local
// PostgreSQL (production on Ubuntu) using a connection string from the
// environment. SSL is enabled automatically for Neon-style URLs and
// disabled for localhost connections.

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined
}

function getConnectionString(): string {
  const connectionString =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.DATABASE_URL_UNPOOLED

  if (!connectionString) {
    throw new Error(
      "Missing database connection string. Set DATABASE_URL (or POSTGRES_URL/POSTGRES_PRISMA_URL) in your environment.",
    )
  }

  return connectionString
}

function createPool(): Pool {
  const connectionString = getConnectionString()
  const needsSsl =
    /sslmode=(require|verify-full|verify-ca|prefer)/.test(connectionString) ||
    /neon\.tech/.test(connectionString) ||
    /neon\.postgres\.azure\.com/.test(connectionString)

  return new Pool({
    connectionString,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    max: 10,
  })
}

export function getPool(): Pool {
  if (!globalThis.__pgPool) {
    globalThis.__pgPool = createPool()
  }
  return globalThis.__pgPool
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }> {
  const res = await getPool().query(text, params)
  return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 }
}
