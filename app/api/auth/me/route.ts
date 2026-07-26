import { getCurrentUser } from "@/lib/auth"
import { getStudentAcademicForUser, getInstituteAcademicSettings } from "@/lib/student-academic"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return Response.json({ user: null })
  const requiresSetup = !!user.force_password_change

  let academic = null
  let academic_settings = null
  try {
    academic_settings = await getInstituteAcademicSettings()
    if (user.role === "student" && user.reg_no) {
      academic = await getStudentAcademicForUser(user.reg_no)
    }
  } catch {
    /* schema may not be ready yet */
  }

  return Response.json({
    requires_setup: requiresSetup,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      display_name: user.display_name,
      reg_no: user.reg_no,
      branch: user.branch,
      force_password_change: user.force_password_change,
      is_demo: user.is_demo,
      requires_setup: requiresSetup,
      academic,
      is_alumni: academic?.is_alumni === true,
      read_only_portal: academic?.read_only_portal === true,
    },
    academic_settings,
  })
}
