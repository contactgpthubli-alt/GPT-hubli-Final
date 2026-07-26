/**
 * Login as each HOD and verify attendance + students are branch-scoped.
 */
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, "..")

function loadEnv() {
  const envPath = path.join(root, ".env.local")
  const env = { ...process.env }
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!m) continue
      let v = m[2]
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1)
      }
      if (env[m[1]] == null) env[m[1]] = v
    }
  }
  return env
}

const BASE = process.env.PROBE_BASE || "https://gpt-hubli-final.vercel.app"
const PASSWORD = "Test@123"

const HODS = [
  { id: "HODCEGPTH", branch: "Civil Engineering" },
  { id: "HODCSGPTH", branch: "Computer Science and Engineering" },
  { id: "HODECGPTH", branch: "Electronics and Communication Engineering" },
  { id: "HODMEGPTH", branch: "Mechanical Engineering" },
]

function cookieFrom(res) {
  const raw = res.headers.getSetCookie?.() || []
  if (raw.length) {
    return raw.map((c) => c.split(";")[0]).join("; ")
  }
  const single = res.headers.get("set-cookie")
  if (!single) return ""
  return single.split(",").map((p) => p.split(";")[0].trim()).filter((x) => x.includes("=")).join("; ")
}

async function login(identifier) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: identifier, identifier, password: PASSWORD }),
  })
  const data = await res.json().catch(() => ({}))
  const cookie = cookieFrom(res)
  return { status: res.status, data, cookie }
}

async function getJson(path, cookie) {
  const res = await fetch(`${BASE}${path}`, {
    headers: cookie ? { cookie } : {},
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

async function postJson(path, cookie, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

async function main() {
  console.log("Probing", BASE)
  // Prefer local if PROBE_BASE set; else production may not have new attendance code yet
  for (const h of HODS) {
    const lg = await login(h.id)
    console.log("\n===", h.id, "login", lg.status, "role=", lg.data?.user?.role, "branch=", lg.data?.user?.branch)
    if (!lg.cookie || lg.status !== 200) {
      console.log("  FAIL login", lg.data)
      continue
    }
    if (lg.data?.user?.branch !== h.branch) {
      console.log("  WARN branch mismatch expected", h.branch)
    }
    const st = await getJson("/api/students?_ts=" + Date.now(), lg.cookie)
    const list = st.data?.students || []
    const depts = new Set(list.map((s) => s.dept))
    const other = [...depts].filter((d) => d && d !== h.branch && d !== "—")
    console.log(
      "  students",
      st.status,
      "count=",
      list.length,
      "scope=",
      st.data?.scope,
      "branches_api=",
      st.data?.branches,
      "other_depts=",
      other.slice(0, 5),
    )
    if (other.length) console.log("  FAIL: students leaked other branches")

    const att = await getJson("/api/attendance?limit=5&_ts=" + Date.now(), lg.cookie)
    console.log("  attendance GET", att.status, "sessions=", (att.data?.sessions || att.data?.attendance || []).length, "scope=", att.data?.scope)

    // Post a tiny dry session if we have at least 1 student
    if (list.length) {
      const sample = list.filter((s) => s.reg_no).slice(0, 3)
      if (sample.length) {
        const post = await postJson("/api/attendance", lg.cookie, {
          branch: h.branch,
          subject: "Probe Attendance Session",
          year: null,
          date: new Date().toISOString().slice(0, 10),
          class_type: "Regular Class",
          entries: sample.map((s, i) => ({
            reg: s.reg_no,
            name: s.name,
            status: i === 0 ? "A" : "P",
          })),
        })
        console.log("  attendance POST", post.status, post.data?.ok ? "ok" : post.data?.error || post.data)
      }
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
