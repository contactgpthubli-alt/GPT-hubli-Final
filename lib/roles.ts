// All non-student roles are considered "staff-side" and may read
// administrative data. Fine-grained write permissions are enforced
// per-route.
export const STAFF_ROLES = [
  "admin",
  "principal",
  "hod",
  "faculty",
  "registrar",
  "acm",
  "exam",
  "est",
  "library",
  "placement",
  "nss",
  "yrc",
  "alumni",
  "sports",
  "welfare",
  "cash",
  "accounts",
  "stores",
  "studentassoc",
]

export const RESULT_WRITERS = ["admin", "hod", "faculty", "exam"]
export const STAFF_WRITERS = ["admin", "est", "registrar"]
export const STUDENT_WRITERS = ["admin", "registrar"]
export const NOTICE_WRITERS = ["admin", "principal", "registrar"]
export const GALLERY_WRITERS = ["admin"]
export const COMMITTEE_WRITERS = ["admin", "principal"]
export const FORM_WRITERS = ["admin", "principal", "hod", "faculty", "registrar"]
export const GRIEVANCE_RESOLVERS = ["admin", "principal"]
