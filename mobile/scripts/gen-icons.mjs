import Jimp from "jimp"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, "..")
const src = path.resolve(root, "../public/images/college-logo.png")
const res = path.resolve(root, "android/app/src/main/res")

const sizes = {
  "mipmap-mdpi": 48,
  "mipmap-hdpi": 72,
  "mipmap-xhdpi": 96,
  "mipmap-xxhdpi": 144,
  "mipmap-xxxhdpi": 192,
}

async function makeIcon(size, outPath, bg = 0xffffffff, fit = 0.88) {
  const logo = await Jimp.read(src)
  const canvas = new Jimp(size, size, bg)
  const max = Math.max(1, Math.floor(size * fit))
  logo.scaleToFit(max, max)
  const x = Math.floor((size - logo.bitmap.width) / 2)
  const y = Math.floor((size - logo.bitmap.height) / 2)
  canvas.composite(logo, x, y)
  await canvas.writeAsync(outPath)
}

for (const [folder, size] of Object.entries(sizes)) {
  const dir = path.join(res, folder)
  fs.mkdirSync(dir, { recursive: true })
  await makeIcon(size, path.join(dir, "ic_launcher.png"), 0xffffffff, 0.9)
  await makeIcon(size, path.join(dir, "ic_launcher_round.png"), 0xffffffff, 0.9)
  // Adaptive foreground should be ~108dp base; use larger canvas for xxxhdpi
  const fg = Math.round((size * 108) / 48)
  await makeIcon(fg, path.join(dir, "ic_launcher_foreground.png"), 0x0f2d5cff, 0.72)
  console.log("ok", folder, size)
}

const draw = path.join(res, "drawable")
fs.mkdirSync(draw, { recursive: true })
await makeIcon(288, path.join(draw, "splash.png"), 0x0f2d5cff, 0.7)

// Also copy into www for PWA-ish icon
const wwwIcon = path.join(root, "www", "icon-192.png")
await makeIcon(192, wwwIcon, 0xffffffff, 0.9)

const anyDir = path.join(res, "mipmap-anydpi-v26")
fs.mkdirSync(anyDir, { recursive: true })
const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`
fs.writeFileSync(path.join(anyDir, "ic_launcher.xml"), adaptive)
fs.writeFileSync(path.join(anyDir, "ic_launcher_round.xml"), adaptive)
fs.mkdirSync(path.join(res, "values"), { recursive: true })
fs.writeFileSync(
  path.join(res, "values", "ic_launcher_background.xml"),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#0F2D5C</color>
</resources>
`,
)

console.log("College logo icons written.")
