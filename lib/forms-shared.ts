/**
 * Client-safe form helpers (no database imports).
 */

export type FormField = {
  id?: string
  type?: string
  question?: string
  label?: string
  required?: boolean
  options?: string[]
  desc?: string
  max_mb?: number
  accept?: string
}

export function parseFormFields(raw: unknown): FormField[] {
  if (Array.isArray(raw)) return raw as FormField[]
  if (typeof raw === "string") {
    try {
      const j = JSON.parse(raw)
      return Array.isArray(j) ? (j as FormField[]) : []
    } catch {
      return []
    }
  }
  return []
}

export function fieldLabel(f: FormField): string {
  return String(f.question || f.label || f.id || "Question").trim() || "Question"
}

export function fieldMaxMb(f: FormField | null | undefined): number {
  const n = Number(f?.max_mb)
  if (!Number.isFinite(n) || n <= 0) return 2
  return Math.min(15, Math.max(0.5, n))
}

export function approxBase64Bytes(b64: string): number {
  const s = String(b64 || "").replace(/\s/g, "")
  const pure = s.includes(",") ? s.split(",").pop() || "" : s
  return Math.floor((pure.length * 3) / 4)
}
