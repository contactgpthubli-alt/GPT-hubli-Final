import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'

const projectRoot = path.resolve(process.cwd())

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
  const env = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || process.env.DATABASE_URL_UNPOOLED
  if (env) return env
  const local = parseEnvFile(path.join(projectRoot, '.env.local'))
  return local.DATABASE_URL || local.POSTGRES_URL || local.POSTGRES_PRISMA_URL || local.DATABASE_URL_UNPOOLED || null
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
      const newline = sql.indexOf('\n', i)
      if (newline === -1) {
        i = sql.length
        continue
      }
      i = newline
      continue
    }
    if (char === ';') {
      const stmt = current.trim()
      if (stmt) statements.push(stmt)
      current = ''
      continue
    }
    current += char
  }
  const last = current.trim()
  if (last) statements.push(last)
  return statements
}

async function run() {
  const connectionString = resolveConnectionString()
  if (!connectionString) {
    console.error('No connection string found. Set DATABASE_URL in .env.local or environment.')
    process.exit(1)
  }
  const client = new Client({
    connectionString,
    ssl: connectionString.includes('neon') || connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
  })
  await client.connect()
  console.log('Connected to Neon successfully.')
  const schemaSql = readFileSync(path.join(projectRoot, 'scripts', '001_schema.sql'), 'utf8')
  const statements = splitStatements(schemaSql)
  console.log('Parsed', statements.length, 'schema statements')
  for (let idx = 0; idx < statements.length; idx += 1) {
    const stmt = statements[idx]
    console.log('Executing schema statement', idx + 1)
    try {
      await client.query(stmt)
    } catch (error) {
      console.error('Schema error at statement', idx + 1)
      console.error(error instanceof Error ? error.message : error)
      console.error('Statement content:')
      console.error(stmt.slice(0, 1000))
      await client.end()
      process.exit(1)
    }
  }
  console.log('Schema applied successfully.')
  await client.end()
}

run().catch((e) => {
  console.error('Fatal error:', e instanceof Error ? e.message : e)
  process.exit(1)
})
