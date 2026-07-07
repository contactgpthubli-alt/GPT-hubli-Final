import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {}
  const raw = readFileSync(filePath, 'utf8')
  const values = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

function resolveConnectionString() {
  const candidates = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
    process.env.POSTGRES_PRISMA_URL,
    process.env.DATABASE_URL_UNPOOLED,
  ].filter(Boolean)

  if (candidates.length > 0) return candidates[0]

  const envFiles = [path.join(projectRoot, '.env.local'), path.join(projectRoot, '.env')]
  for (const file of envFiles) {
    const values = parseEnvFile(file)
    const value = [
      values.DATABASE_URL,
      values.POSTGRES_URL,
      values.POSTGRES_PRISMA_URL,
      values.DATABASE_URL_UNPOOLED,
    ].find(Boolean)
    if (value) return value
  }

  return null
}

function splitStatements(sql) {
  const statements = []
  let current = ''
  let quote = null
  let escaped = false

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i]
    const next = sql[i + 1]

    if (quote) {
      current += char
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        quote = null
      }
      continue
    }

    if (char === "'" || char === '"') {
      quote = char
      current += char
      continue
    }

    if (char === '-' && next === '-') {
      const end = sql.indexOf('\n', i)
      if (end === -1) {
        break
      }
      current += sql.slice(i, end)
      i = end - 1
      continue
    }

    if (char === ';') {
      const stmt = current.trim()
      if (stmt) {
        statements.push(stmt)
      }
      current = ''
      continue
    }

    current += char
  }

  const tail = current.trim()
  if (tail) {
    statements.push(tail)
  }

  return statements.filter((statement) => statement && !statement.startsWith('--'))
}

async function run() {
  const connectionString = resolveConnectionString()
  if (!connectionString) {
    console.error('No database connection string found. Set DATABASE_URL (or POSTGRES_URL/POSTGRES_PRISMA_URL) in your environment or .env.local.')
    process.exit(1)
  }

  const client = new Client({
    connectionString,
    ssl: connectionString.includes('neon') || connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
  })

  try {
    await client.connect()
    console.log('Connected to the database successfully.')

    const schemaSql = readFileSync(path.join(projectRoot, 'scripts/001_schema.sql'), 'utf8')
    const seedSql = readFileSync(path.join(projectRoot, 'scripts/002_seed.sql'), 'utf8')

    for (const statement of splitStatements(schemaSql)) {
      await client.query(statement)
    }
    console.log('Applied database schema.')

    for (const statement of splitStatements(seedSql)) {
      await client.query(statement)
    }
    console.log('Applied seed data.')
  } catch (error) {
    console.error('Database initialization failed:')
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  } finally {
    await client.end()
  }
}

run()
