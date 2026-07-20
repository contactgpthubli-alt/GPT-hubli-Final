import { getCurrentUser } from "@/lib/auth"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return Response.json({ user: null })
  const requiresSetup = !!user.force_password_change
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
    },
  })
}
