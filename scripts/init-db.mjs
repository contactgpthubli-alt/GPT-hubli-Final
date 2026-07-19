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

async function run() {
  const connectionString = resolveConnectionString()
  if (!connectionString) {
    console.error('No database connection string found. Set DATABASE_URL (or POSTGRES_URL/POSTGRES_PRISMA_URL) in your environment or .env.local.')
    process.exit(1)
  }

  console.log('Using host:', new URL(connectionString).hostname)

  const client = new Client({
    connectionString,
    ssl: connectionString.includes('neon') || connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
  })

  try {
    await client.connect()
    console.log('Connected to the database successfully.')

    const schemaSql = readFileSync(path.join(projectRoot, 'scripts/001_schema.sql'), 'utf8')
    const seedSql = readFileSync(path.join(projectRoot, 'scripts/002_seed.sql'), 'utf8')
    const profileRequestsSql = readFileSync(path.join(projectRoot, 'scripts/003_profile_requests.sql'), 'utf8')
    const usersBranchSql = readFileSync(path.join(projectRoot, 'scripts/004_users_branch.sql'), 'utf8')
    const usersSoftDeleteSql = readFileSync(path.join(projectRoot, 'scripts/005_users_soft_delete.sql'), 'utf8')
    const profileSchemaSql = readFileSync(path.join(projectRoot, 'scripts/006_profile_schema.sql'), 'utf8')
    const tcModuleSql = readFileSync(path.join(projectRoot, 'scripts/007_tc_module.sql'), 'utf8')
    const studyCertsSql = readFileSync(path.join(projectRoot, 'scripts/008_study_certs.sql'), 'utf8')
    const acmSendStudentSql = readFileSync(path.join(projectRoot, 'scripts/009_acm_cert_send_student.sql'), 'utf8')

    await client.query(schemaSql)
    console.log('Applied database schema.')

    await client.query(seedSql)
    console.log('Applied seed data.')

    await client.query(profileRequestsSql)
    console.log('Applied profile_requests migration.')

    await client.query(usersBranchSql)
    console.log('Applied users.branch migration.')

    await client.query(usersSoftDeleteSql)
    console.log('Applied users soft-delete migration.')

    await client.query(profileSchemaSql)
    console.log('Applied profile_schemas migration.')

    await client.query(tcModuleSql)
    console.log('Applied TC module migration.')

    await client.query(studyCertsSql)
    console.log('Applied Study/Studying certificate migration.')

    await client.query(acmSendStudentSql)
    console.log('Applied ACM cert send-to-student migration.')
  } catch (error) {
    console.error('Database initialization failed:')
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  } finally {
    await client.end()
  }
}

run()
