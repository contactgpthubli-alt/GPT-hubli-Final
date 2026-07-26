/**
 * Check if absent notifications are stored and returned by API.
 */
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import pg from "pg"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, "..")
function loadEnv() {
  const env = { ...process.env }
  const p = path.join(root, ".env.local")
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!m) continue
      let v = m[2]
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      if (env[m[1]] == null) env[m[1]] = v
    }
  }
  return env
}

const BASE = process.env.PROBE_BASE || "https://gpt-hubli-final.vercel.app"

async function main() {
  const env = loadEnv()
  const client = new pg.Client({
    connectionString: env.DATABASE_URL || env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()

  const kinds = await client.query(
    `SELECT kind, COUNT(*)::int n, MAX(created_at) last
       FROM user_notifications
      GROUP BY kind
      ORDER BY last DESC NULLS LAST
      LIMIT 20`,
  )
  console.log("notification kinds:", kinds.rows)

  const recent = await client.query(
    `SELECT n.id, n.user_id, u.reg_no, n.title, n.kind, n.created_at, n.read_at,
            left(n.body, 120) AS body
       FROM user_notifications n
       LEFT JOIN users u ON u.id = n.user_id
      WHERE n.kind ILIKE '%absent%' OR n.title ILIKE '%absent%'
      ORDER BY n.created_at DESC
      LIMIT 15`,
  )
  console.log("absent rows:", recent.rows)

  // sample CS student + simulate notify path lookup
  const sample = await client.query(
    `SELECT u.id, u.reg_no, u.display_name FROM users u
      WHERE u.role='student' AND u.reg_no ILIKE '171CS%' AND u.deleted_at IS NULL
      ORDER BY u.id DESC LIMIT 3`,
  )
  console.log("sample users:", sample.rows)

  await client.end()

  // API: login as student and fetch notifications
  if (sample.rows[0]?.reg_no) {
    // we don't know password — login as HOD and check roster instead
  }

  // login HOD and POST a tiny attendance mark then check DB again would need password
  const login = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "HODCSGPTH", password: "Test@123" }),
  })
  const cookies = login.headers.getSetCookie?.() || []
  const cookie = cookies.map((c) => c.split(";")[0]).join("; ")
  console.log("HOD login", login.status)

  if (sample.rows[0]?.reg_no) {
    const reg = sample.rows[0].reg_no
    const post = await fetch(BASE + "/api/attendance", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        branch: "Computer Science and Engineering",
        subject: "Notify Test Subject",
        date: new Date().toISOString().slice(0, 10),
        time: "15:45",
        class_type: "Regular Class",
        entries: [{ reg, name: sample.rows[0].display_name, status: "A", present: false }],
      }),
    })
    const pdata = await post.json().catch(() => ({}))
    console.log("attendance POST", post.status, pdata.ok, "absent_notified=", pdata.absent_notified, pdata.error)

    // recheck notifs
    const env2 = loadEnv()
    const c2 = new pg.Client({
      connectionString: env2.DATABASE_URL || env2.POSTGRES_URL,
      ssl: { rejectUnauthorized: false },
    })
    await c2.connect()
    const after = await c2.query(
      `SELECT id, kind, title, left(body,100) body, created_at
         FROM user_notifications
        WHERE user_id = $1
        ORDER BY created_at DESC LIMIT 5`,
      [sample.rows[0].id],
    )
    console.log("after notifs for", reg, after.rows)
    await c2.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
