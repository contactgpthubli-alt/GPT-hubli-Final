/**
 * Verify academic year APIs for admin + one HOD.
 */
const BASE = process.env.PROBE_BASE || "http://localhost:3000"
const PASSWORD = "Test@123"

function cookieFrom(res) {
  const raw = res.headers.getSetCookie?.() || []
  if (raw.length) return raw.map((c) => c.split(";")[0]).join("; ")
  const single = res.headers.get("set-cookie")
  if (!single) return ""
  return single
    .split(",")
    .map((p) => p.split(";")[0].trim())
    .filter((x) => x.includes("="))
    .join("; ")
}

async function login(id) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: id, identifier: id, password: PASSWORD }),
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data, cookie: cookieFrom(res) }
}

async function get(path, cookie) {
  const res = await fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {} })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

async function post(path, cookie, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

async function main() {
  console.log("BASE", BASE)

  // Try common admin usernames
  const adminIds = ["akshay", "admin", "root", "AKSHAY"]
  let admin = null
  for (const id of adminIds) {
    const lg = await login(id)
    if (lg.status === 200 && lg.data?.user?.role === "admin") {
      admin = lg
      console.log("Admin login OK as", id)
      break
    }
  }
  if (!admin) {
    console.log("Admin login failed with known ids — checking HOD only")
  } else {
    const set = await get("/api/institute-settings", admin.cookie)
    console.log("GET institute-settings", set.status, set.data?.academic, "can_edit=", set.data?.can_edit)
    const stu = await get("/api/students?include_alumni=1", admin.cookie)
    const list = stu.data?.students || []
    const statuses = {}
    list.forEach((s) => {
      const k = s.academic_status || "?"
      statuses[k] = (statuses[k] || 0) + 1
    })
    console.log("Admin students", stu.status, "count", list.length, "statuses", statuses)
    console.log("academic_settings", stu.data?.academic_settings)
    const withAdm = list.filter((s) => s.admission_academic_year).length
    console.log("with admission_academic_year", withAdm)
  }

  const hod = await login("HODCEGPTH")
  console.log("HODCE login", hod.status, hod.data?.user?.branch)
  if (hod.cookie) {
    const set = await get("/api/institute-settings", hod.cookie)
    console.log("HOD GET settings", set.status, set.data?.academic, "can_edit=", set.data?.can_edit)
    const stu = await get("/api/students?include_alumni=1", hod.cookie)
    const list = stu.data?.students || []
    const other = list.filter((s) => s.dept && !/civil/i.test(s.dept))
    console.log(
      "HOD students",
      stu.status,
      "count",
      list.length,
      "other_branch",
      other.length,
      "sample years",
      list.slice(0, 5).map((s) => [s.reg_no, s.year, s.academic_status, s.admission_academic_year]),
    )
    // academic action dry: set_admission on first student if any
    const sample = list.find((s) => s.reg_no)
    if (sample) {
      const r = await post("/api/students/academic", hod.cookie, {
        action: "recompute",
        reg_no: sample.reg_no,
      })
      console.log("HOD recompute", sample.reg_no, r.status, r.data?.academic?.year_label, r.data?.academic?.academic_status)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
