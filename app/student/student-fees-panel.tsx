"use client"

import { useCallback, useEffect, useState } from "react"

type ApiResult<T> = { ok: boolean; status: number; data: T | null; error?: string }
type ApiFn = <T = unknown>(path: string, opts?: RequestInit) => Promise<ApiResult<T>>

type FeeLine = { label?: string; amount?: number; note?: string }
type Challan = { receipt_no: string; amount: number }

type FeeBundle = {
  fees?: {
    total?: number
    fine?: number
    fine_label?: string | null
    lines?: FeeLine[]
  } | null
  fine_schedule?: {
    resolved?: { fine?: number; label?: string | null }
    fine?: number
    label?: string | null
  } | null
  payment?: {
    status?: string
    computed_total?: number
    challan_total?: number
    challans?: Challan[]
    student_note?: string | null
    staff_note?: string | null
    paid_marked_by_name?: string | null
    paid_marked_by_role?: string | null
    paid_marked_at?: string | null
  } | null
  cycle?: {
    id?: number
    month_label?: string
    label?: string
    status?: string
    fee_per_subject?: number
  } | null
  eligible?: Array<{ subject_code?: string; subject_name?: string }>
  note?: string
}

type AdmBundle = {
  status?: string
  year_label?: string
  study_year?: number
  live?: { status?: string; label?: string }
  record?: {
    status?: string
    amount?: string | null
    receipt_no?: string | null
    paid_date?: string | null
    student_note?: string | null
    verified_by_name?: string | null
    verified_by_role?: string | null
    verified_at?: string | null
  } | null
}

const K2_CHALLAN_URL =
  "https://k2.karnataka.gov.in/wps/portal/Khajane-II/Scope/Remittance/ChallanGeneration/!ut/p/z1/04_Sj9CPykssy0xPLMnMz0vMAfIjo8ziTSycnQ39nQ38LVx8LA0C_f3DQn28PAwNQkz1w8EKDHAARwP9KGL041EQhd_4cP0ovFa4GBJQYGFEQIGBAVQBHlcU5IZGGGR6pgMA7DD6nQ!!/dz/d5/L2dBISEvZ0FBIS9nQSEh/"
const K2_SAMPLE_PDF = "/docs/sample-k2-challan.pdf"

type FeeTab = "exam" | "makeup" | "admission"

function statusClass(st?: string) {
  const s = String(st || "").toLowerCase()
  if (s === "paid") return "stu-badge stu-badge-ok"
  if (s === "pending" || s === "challan_submitted" || s === "partial") return "stu-badge stu-badge-warn"
  if (s === "due" || s === "not_paid" || s === "rejected") return "stu-badge stu-badge-err"
  return "stu-badge stu-badge-info"
}

function statusLabel(st?: string) {
  const s = String(st || "not_paid")
  if (s === "challan_submitted") return "Challan submitted"
  if (s === "not_paid") return "Not paid"
  if (s === "rejected") return "Rejected — fix and resubmit"
  return s.replace(/_/g, " ")
}

export function StudentFeesPanel({
  api,
  flash,
  readOnly,
  onBack,
}: {
  api: ApiFn
  flash: (msg: string) => void
  readOnly?: boolean
  onBack: () => void
}) {
  const [tab, setTab] = useState<FeeTab>("exam")
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState("")
  const [msg, setMsg] = useState("")

  const [adm, setAdm] = useState<AdmBundle | null>(null)
  const [regular, setRegular] = useState<FeeBundle | null>(null)
  const [makeup, setMakeup] = useState<FeeBundle | null>(null)

  const [regChallans, setRegChallans] = useState<Challan[]>([
    { receipt_no: "", amount: 0 },
    { receipt_no: "", amount: 0 },
  ])
  const [regNote, setRegNote] = useState("")
  const [mkChallans, setMkChallans] = useState<Challan[]>([
    { receipt_no: "", amount: 0 },
    { receipt_no: "", amount: 0 },
  ])
  const [mkNote, setMkNote] = useState("")
  const [admAmount, setAdmAmount] = useState("")
  const [admReceipt, setAdmReceipt] = useState("")
  const [admDate, setAdmDate] = useState("")
  const [admNote, setAdmNote] = useState("")

  const loadAll = useCallback(async () => {
    setLoading(true)
    setErr("")
    const [a, r, m] = await Promise.all([
      api<AdmBundle>("/api/admission-fees"),
      api<FeeBundle>("/api/exam/fees"),
      api<FeeBundle>("/api/exam/makeup/fees"),
    ])
    if (a.ok) {
      setAdm(a.data)
      const rec = a.data?.record
      if (rec) {
        setAdmAmount(rec.amount || "")
        setAdmReceipt(rec.receipt_no || "")
        setAdmDate(rec.paid_date ? String(rec.paid_date).slice(0, 10) : "")
        setAdmNote(rec.student_note || "")
      }
    }
    if (r.ok) {
      setRegular(r.data)
      const ch = r.data?.payment?.challans
      if (ch && ch.length) {
        setRegChallans(
          ch.map((c) => ({
            receipt_no: c.receipt_no || "",
            amount: Number(c.amount) || 0,
          })),
        )
      }
      if (r.data?.payment?.student_note) setRegNote(String(r.data.payment.student_note))
    }
    if (m.ok) {
      setMakeup(m.data)
      const ch = m.data?.payment?.challans
      if (ch && ch.length) {
        setMkChallans(
          ch.map((c) => ({
            receipt_no: c.receipt_no || "",
            amount: Number(c.amount) || 0,
          })),
        )
      }
      if (m.data?.payment?.student_note) setMkNote(String(m.data.payment.student_note))
    }
    if (!a.ok && !r.ok && !m.ok) {
      setErr(a.error || r.error || m.error || "Could not load fees")
    }
    setLoading(false)
  }, [api])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  async function submitRegular() {
    setErr("")
    setMsg("")
    const challans = regChallans
      .map((c) => ({
        receipt_no: String(c.receipt_no || "").trim(),
        amount: Number(c.amount) || 0,
      }))
      .filter((c) => c.receipt_no && c.amount > 0)
    if (!challans.length) {
      setErr("Enter at least one K2 receipt number and amount.")
      return
    }
    setBusy(true)
    const res = await api("/api/exam/fees", {
      method: "POST",
      body: JSON.stringify({ challans, note: regNote || undefined }),
    })
    setBusy(false)
    if (!res.ok) {
      setErr(res.error || "Submit failed")
      return
    }
    setMsg("Regular exam challan submitted for Exam Section verification.")
    flash("Exam fee challan submitted")
    void loadAll()
  }

  async function submitMakeup() {
    setErr("")
    setMsg("")
    if (!makeup?.cycle || makeup.cycle.status !== "open") {
      setErr("Makeup fees are not open yet. Exam Section must declare a makeup month first.")
      return
    }
    const challans = mkChallans
      .map((c) => ({
        receipt_no: String(c.receipt_no || "").trim(),
        amount: Number(c.amount) || 0,
      }))
      .filter((c) => c.receipt_no && c.amount > 0)
    if (!challans.length) {
      setErr("Enter at least one K2 receipt number and amount for makeup.")
      return
    }
    setBusy(true)
    const res = await api("/api/exam/makeup/fees", {
      method: "POST",
      body: JSON.stringify({
        challans,
        note: mkNote || undefined,
        cycle_id: makeup.cycle.id,
      }),
    })
    setBusy(false)
    if (!res.ok) {
      setErr(res.error || "Submit failed")
      return
    }
    setMsg("Makeup challan submitted for Exam Section verification.")
    flash("Makeup fee challan submitted")
    void loadAll()
  }

  async function submitAdmission() {
    setErr("")
    setMsg("")
    if (!admAmount.trim() || !admReceipt.trim()) {
      setErr("Amount and receipt number are required for admission fees.")
      return
    }
    setBusy(true)
    const res = await api("/api/admission-fees", {
      method: "POST",
      body: JSON.stringify({
        amount: admAmount.trim(),
        receipt_no: admReceipt.trim(),
        paid_date: admDate || undefined,
        note: admNote || undefined,
      }),
    })
    setBusy(false)
    if (!res.ok) {
      setErr(res.error || "Submit failed")
      return
    }
    setMsg("Admission fee proof submitted. Verifier will mark Paid / Not paid.")
    flash("Admission fee submitted")
    void loadAll()
  }

  const admStatus = adm?.live?.status || adm?.status || adm?.record?.status || "not_paid"
  const admLiveLabel = adm?.live?.label || statusLabel(admStatus)
  const regPaySt = regular?.payment?.status
  const mkPaySt = makeup?.payment?.status
  const regFine =
    regular?.fine_schedule?.resolved?.label ||
    regular?.fees?.fine_label ||
    (regular?.fees?.fine != null ? `Fine ₹${regular.fees.fine}` : null)
  const mkFine =
    makeup?.fine_schedule?.label ||
    (makeup?.fine_schedule?.fine != null ? `Fine ₹${makeup.fine_schedule.fine}` : null)

  function K2Card() {
    return (
      <div className="stu-sec-card" style={{ borderColor: "#fdba74", background: "#fff7ed" }}>
        <h4 style={{ color: "#9a3412" }}>K2 challan — use these exact details</h4>
        <ul style={{ margin: "0 0 10px", paddingLeft: "1.1rem", fontSize: "0.84rem", lineHeight: 1.55, color: "#7c2d12" }}>
          <li>
            <strong>District:</strong> Bengaluru Urban
          </li>
          <li>
            <strong>Department:</strong> DEPARTMENT OF TECHNICAL EDUCATION
          </li>
          <li>
            <strong>DDO Office:</strong> DIRECTORATE OF TECHNICAL EDUCATION, BANGALORE
          </li>
          <li>
            <strong>DDO Code:</strong> 14254O
          </li>
        </ul>
        <div className="stu-actions" style={{ marginTop: 0 }}>
          <a className="stu-btn stu-btn-primary stu-btn-sm" href={K2_CHALLAN_URL} target="_blank" rel="noopener noreferrer">
            Open K2 Challan
          </a>
          <a className="stu-btn stu-btn-ghost stu-btn-sm" href={K2_SAMPLE_PDF} target="_blank" rel="noopener noreferrer">
            Sample PDF
          </a>
        </div>
      </div>
    )
  }

  function ChallanEditor({
    rows,
    setRows,
  }: {
    rows: Challan[]
    setRows: (r: Challan[]) => void
  }) {
    return (
      <>
        {rows.map((row, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 8, marginBottom: 8 }}>
            <div className="stu-field" style={{ margin: 0 }}>
              <label>Receipt {i + 1}</label>
              <input
                value={row.receipt_no}
                disabled={readOnly}
                placeholder="K2 receipt no."
                onChange={(e) => {
                  const next = rows.slice()
                  next[i] = { ...next[i], receipt_no: e.target.value }
                  setRows(next)
                }}
              />
            </div>
            <div className="stu-field" style={{ margin: 0 }}>
              <label>Amount ₹</label>
              <input
                type="number"
                inputMode="decimal"
                value={row.amount || ""}
                disabled={readOnly}
                placeholder="0"
                onChange={(e) => {
                  const next = rows.slice()
                  next[i] = { ...next[i], amount: Number(e.target.value) || 0 }
                  setRows(next)
                }}
              />
            </div>
          </div>
        ))}
        {!readOnly ? (
          <button
            type="button"
            className="stu-btn stu-btn-ghost stu-btn-sm"
            onClick={() => setRows([...rows, { receipt_no: "", amount: 0 }])}
          >
            + Add another challan
          </button>
        ) : null}
      </>
    )
  }

  return (
    <div className="stu-card">
      <button type="button" className="stu-btn stu-btn-ghost stu-btn-sm" style={{ marginBottom: 12 }} onClick={onBack}>
        ← Back
      </button>
      <h3>Fees</h3>
      <p style={{ fontSize: "0.82rem", color: "var(--stu-muted)", marginTop: 0, lineHeight: 1.45 }}>
        Regular exam fees, makeup fees, and admission fees. Pay on official <strong>K2</strong>, then submit receipt
        numbers here. Exam / ACM mark Paid after offline verify.
      </p>

      {/* Live admission status bar */}
      <div
        className="stu-sec-card"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "center",
          justifyContent: "space-between",
          borderWidth: 2,
        }}
      >
        <div>
          <div style={{ fontSize: "0.72rem", fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", opacity: 0.7 }}>
            Admission fees
          </div>
          <div style={{ marginTop: 6 }}>
            <span className={statusClass(admStatus)}>{admLiveLabel}</span>
            {adm?.year_label ? (
              <span style={{ marginLeft: 8, fontSize: "0.8rem", color: "var(--stu-muted)" }}>{adm.year_label}</span>
            ) : null}
          </div>
        </div>
        {adm?.record?.verified_by_name ? (
          <div style={{ fontSize: "0.78rem", color: "var(--stu-muted)", maxWidth: "100%" }}>
            {statusLabel(adm.record.status)} by {adm.record.verified_by_name}
            {adm.record.verified_by_role ? ` (${adm.record.verified_by_role})` : ""}
          </div>
        ) : null}
      </div>

      <div className="stu-chip-row" style={{ margin: "12px 0" }}>
        <button type="button" className={`stu-chip ${tab === "exam" ? "act" : ""}`} onClick={() => setTab("exam")}>
          Regular exam
        </button>
        <button type="button" className={`stu-chip ${tab === "makeup" ? "act" : ""}`} onClick={() => setTab("makeup")}>
          Makeup
          {makeup?.cycle?.status === "open" ? " · Open" : ""}
        </button>
        <button
          type="button"
          className={`stu-chip ${tab === "admission" ? "act" : ""}`}
          onClick={() => setTab("admission")}
        >
          Admission
        </button>
      </div>

      {err ? <div className="stu-msg stu-msg-err">{err}</div> : null}
      {msg ? <div className="stu-msg stu-msg-ok">{msg}</div> : null}
      {loading ? <div className="stu-empty">Loading fees…</div> : null}

      {!loading && tab === "exam" ? (
        <>
          <div className="stu-msg stu-msg-info" style={{ fontSize: "0.82rem" }}>
            Base fee from backlog / current semester. Fine is set by Exam Section schedule (you cannot edit it).
          </div>
          <K2Card />
          <div className="stu-sec-card">
            <h4>Fee breakup</h4>
            {regFine ? (
              <div className="stu-row">
                <span className="k">Fine window</span>
                <span className="v">{regFine}</span>
              </div>
            ) : null}
            {(regular?.fees?.lines || []).map((ln, i) => (
              <div className="stu-row" key={i}>
                <span className="k">{ln.label || "Line"}</span>
                <span className="v">₹ {ln.amount ?? 0}</span>
              </div>
            ))}
            <div className="stu-row">
              <span className="k">
                <strong>Total</strong>
              </span>
              <span className="v">
                <strong>₹ {regular?.fees?.total ?? regular?.payment?.computed_total ?? 0}</strong>
              </span>
            </div>
            {regPaySt ? (
              <div className="stu-row">
                <span className="k">Status</span>
                <span className="v">
                  <span className={statusClass(regPaySt)}>{statusLabel(regPaySt)}</span>
                </span>
              </div>
            ) : null}
            {regular?.payment?.paid_marked_by_name ? (
              <div style={{ fontSize: "0.78rem", color: "var(--stu-muted)", marginTop: 6 }}>
                Marked by {regular.payment.paid_marked_by_name}
                {regular.payment.paid_marked_by_role ? ` (${regular.payment.paid_marked_by_role})` : ""}
              </div>
            ) : null}
            {regPaySt === "rejected" && regular?.payment?.staff_note ? (
              <div className="stu-msg stu-msg-err" style={{ marginTop: 10, fontSize: "0.84rem", lineHeight: 1.45 }}>
                <strong>Exam Cell removed your submission.</strong>
                <br />
                What is wrong: {regular.payment.staff_note}
                <br />
                Please correct and submit challan details again below.
              </div>
            ) : null}
          </div>
          {!readOnly && regPaySt !== "paid" ? (
            <div className="stu-sec-card">
              <h4>Submit K2 challans</h4>
              <ChallanEditor rows={regChallans} setRows={setRegChallans} />
              <div className="stu-field">
                <label>Note to Exam (optional)</label>
                <input value={regNote} onChange={(e) => setRegNote(e.target.value)} placeholder="Paid in parts…" />
              </div>
              <button type="button" className="stu-btn stu-btn-primary" disabled={busy} onClick={() => void submitRegular()}>
                {busy ? "Submitting…" : "Submit challan details"}
              </button>
            </div>
          ) : null}
          <button type="button" className="stu-btn stu-btn-ghost stu-btn-sm" onClick={() => void loadAll()}>
            🔄 Recalculate
          </button>
        </>
      ) : null}

      {!loading && tab === "makeup" ? (
        <>
          {!makeup?.cycle || makeup.cycle.status !== "open" ? (
            <div className="stu-msg stu-msg-info">
              <strong>Makeup not open.</strong> Exam Section declares a makeup month (e.g. July / August) for failed
              even-sem subjects. Same K2 process as regular when open.
            </div>
          ) : (
            <>
              <div className="stu-msg stu-msg-ok">
                Open: <strong>{makeup.cycle.month_label || makeup.cycle.label || "Makeup"}</strong>
                {makeup.cycle.fee_per_subject != null
                  ? ` · ₹${makeup.cycle.fee_per_subject} per failed subject`
                  : ""}
              </div>
              <K2Card />
              <div className="stu-sec-card">
                <h4>Makeup fee</h4>
                {mkFine ? (
                  <div className="stu-row">
                    <span className="k">Fine</span>
                    <span className="v">{mkFine}</span>
                  </div>
                ) : null}
                {(makeup.eligible || []).length ? (
                  <div style={{ fontSize: "0.8rem", marginBottom: 8 }}>
                    Eligible subjects: {(makeup.eligible || []).map((s) => s.subject_code || s.subject_name).join(", ")}
                  </div>
                ) : (
                  <div className="stu-empty">No eligible failed subjects for makeup right now.</div>
                )}
                {(makeup.fees?.lines || []).map((ln, i) => (
                  <div className="stu-row" key={i}>
                    <span className="k">{ln.label || "Line"}</span>
                    <span className="v">₹ {ln.amount ?? 0}</span>
                  </div>
                ))}
                <div className="stu-row">
                  <span className="k">
                    <strong>Total</strong>
                  </span>
                  <span className="v">
                    <strong>₹ {makeup.fees?.total ?? makeup.payment?.computed_total ?? 0}</strong>
                  </span>
                </div>
                {mkPaySt ? (
                  <div className="stu-row">
                    <span className="k">Status</span>
                    <span className="v">
                      <span className={statusClass(mkPaySt)}>{statusLabel(mkPaySt)}</span>
                    </span>
                  </div>
                ) : null}
                {mkPaySt === "rejected" && makeup.payment?.staff_note ? (
                  <div className="stu-msg stu-msg-err" style={{ marginTop: 10, fontSize: "0.84rem", lineHeight: 1.45 }}>
                    <strong>Exam Cell removed your makeup submission.</strong>
                    <br />
                    What is wrong: {makeup.payment.staff_note}
                    <br />
                    Please correct and submit makeup challan details again.
                  </div>
                ) : null}
              </div>
              {!readOnly && mkPaySt !== "paid" ? (
                <div className="stu-sec-card">
                  <h4>Submit makeup K2 challans</h4>
                  <ChallanEditor rows={mkChallans} setRows={setMkChallans} />
                  <div className="stu-field">
                    <label>Note (optional)</label>
                    <input value={mkNote} onChange={(e) => setMkNote(e.target.value)} />
                  </div>
                  <button
                    type="button"
                    className="stu-btn stu-btn-primary"
                    disabled={busy}
                    onClick={() => void submitMakeup()}
                  >
                    {busy ? "Submitting…" : "Submit makeup challan"}
                  </button>
                </div>
              ) : null}
            </>
          )}
          <button type="button" className="stu-btn stu-btn-ghost stu-btn-sm" onClick={() => void loadAll()}>
            🔄 Refresh
          </button>
        </>
      ) : null}

      {!loading && tab === "admission" ? (
        <>
          <div className="stu-msg stu-msg-info" style={{ fontSize: "0.82rem" }}>
            Enter amount, receipt number and paid date after you pay. Your verifier (Cash / Office / ACM / HOD) confirms{" "}
            <strong>Paid</strong> or <strong>Not paid</strong>.
          </div>
          <div className="stu-sec-card">
            <h4>Status</h4>
            <div className="stu-row">
              <span className="k">Current</span>
              <span className="v">
                <span className={statusClass(admStatus)}>{admLiveLabel}</span>
              </span>
            </div>
            {adm?.record?.amount ? (
              <div className="stu-row">
                <span className="k">Last amount</span>
                <span className="v">₹ {adm.record.amount}</span>
              </div>
            ) : null}
            {adm?.record?.receipt_no ? (
              <div className="stu-row">
                <span className="k">Receipt</span>
                <span className="v">{adm.record.receipt_no}</span>
              </div>
            ) : null}
          </div>
          {!readOnly && admStatus !== "paid" ? (
            <div className="stu-sec-card">
              <h4>Submit payment proof</h4>
              <div className="stu-field">
                <label>Fee amount (₹) *</label>
                <input value={admAmount} onChange={(e) => setAdmAmount(e.target.value)} placeholder="e.g. 12000" />
              </div>
              <div className="stu-field">
                <label>Receipt number *</label>
                <input value={admReceipt} onChange={(e) => setAdmReceipt(e.target.value)} placeholder="Receipt / challan no." />
              </div>
              <div className="stu-field">
                <label>Fees paid date</label>
                <input type="date" value={admDate} onChange={(e) => setAdmDate(e.target.value)} />
              </div>
              <div className="stu-field">
                <label>Note (optional)</label>
                <input value={admNote} onChange={(e) => setAdmNote(e.target.value)} />
              </div>
              <button
                type="button"
                className="stu-btn stu-btn-primary"
                disabled={busy}
                onClick={() => void submitAdmission()}
              >
                {busy ? "Submitting…" : "Submit for verification"}
              </button>
            </div>
          ) : null}
          <button type="button" className="stu-btn stu-btn-ghost stu-btn-sm" onClick={() => void loadAll()}>
            🔄 Refresh status
          </button>
        </>
      ) : null}
    </div>
  )
}
