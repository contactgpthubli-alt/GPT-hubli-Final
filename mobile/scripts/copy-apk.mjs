import { copyFileSync, existsSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const src = join(
  root,
  "android",
  "app",
  "build",
  "outputs",
  "apk",
  "debug",
  "app-debug.apk",
)
const outDir = join(root, "dist")
const dest = join(outDir, "GPT-Hubli-Student-debug.apk")

if (!existsSync(src)) {
  console.error("APK not found at", src)
  process.exit(1)
}
mkdirSync(outDir, { recursive: true })
copyFileSync(src, dest)
console.log("Copied APK ->", dest)
