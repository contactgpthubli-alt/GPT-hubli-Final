/**
 * Capacitor + native Java bridge helpers (Student Android APK).
 * Works when WebView has Capacitor plugins or GpthNative injected.
 */

type CapPlugin = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [method: string]: (...args: any[]) => Promise<any>
}

type CapBridge = {
  isNativePlatform?: () => boolean
  getPlatform?: () => string
  Plugins?: Record<string, CapPlugin>
  convertFileSrc?: (path: string) => string
}

type GpthNativeBridge = {
  savePdfBase64?: (f: string, b: string) => string
  showNotification?: (title: string, body: string, id?: number) => string
  requestNotificationPermission?: () => string
}

function cap(): CapBridge | null {
  if (typeof window === "undefined") return null
  return (window as unknown as { Capacitor?: CapBridge }).Capacitor || null
}

function gpthNative(): GpthNativeBridge | null {
  if (typeof window === "undefined") return null
  return (window as unknown as { GpthNative?: GpthNativeBridge }).GpthNative || null
}

export function isNativeAndroid(): boolean {
  if (gpthNative()) return true
  const c = cap()
  if (!c) return false
  try {
    if (typeof c.isNativePlatform === "function" && c.isNativePlatform()) {
      const p = typeof c.getPlatform === "function" ? c.getPlatform() : ""
      return !p || p === "android" || p === "ios"
    }
  } catch {
    /* ignore */
  }
  // Capacitor remote WebView often still has Capacitor object
  try {
    if (c.Plugins && (c.Plugins.LocalNotifications || c.Plugins.Filesystem)) return true
  } catch {
    /* ignore */
  }
  return false
}

function plugin(name: string): CapPlugin | null {
  const c = cap()
  return (c?.Plugins && c.Plugins[name]) || null
}

let notifChannelReady = false

/** Request notification permission + create high-importance channel (default system tone). */
export async function ensureNativeNotificationChannel(): Promise<boolean> {
  // 1) Native Java bridge (most reliable with remote server.url WebView)
  const gn = gpthNative()
  if (gn && typeof gn.requestNotificationPermission === "function") {
    try {
      gn.requestNotificationPermission()
    } catch {
      /* ignore */
    }
  }

  const LN = plugin("LocalNotifications")
  if (!LN) {
    // Still OK if Java bridge can post notifications
    return !!gn
  }
  try {
    if (typeof LN.requestPermissions === "function") {
      const perm = await LN.requestPermissions()
      const display = perm?.display || perm?.notifications || perm
      if (display === "denied" || display?.display === "denied") {
        // Try Java path anyway
        return !!gn
      }
    }
    if (!notifChannelReady && typeof LN.createChannel === "function") {
      await LN.createChannel({
        id: "gpth_attendance",
        name: "Attendance alerts",
        description: "Absent marks and important student alerts",
        importance: 5,
        visibility: 1,
        sound: "default",
        vibration: true,
        lights: true,
        lightColor: "#DC2626",
      })
      await LN.createChannel({
        id: "gpth_general",
        name: "GPT Hubli alerts",
        description: "General college notifications",
        importance: 5,
        visibility: 1,
        sound: "default",
        vibration: true,
      })
      notifChannelReady = true
    }
    return true
  } catch (e) {
    console.warn("[native] notification setup", e)
    return !!gn
  }
}

/**
 * Show a system notification (status bar + default ringtone).
 * Prefers MainActivity GpthNative (works with remote WebView), then Capacitor plugin.
 */
export async function showNativeNotification(input: {
  title: string
  body: string
  id?: number
  channelId?: string
}): Promise<boolean> {
  const title = input.title || "GPT Hubli"
  const body = (input.body || "").slice(0, 400)
  const nid =
    input.id && Number.isFinite(input.id)
      ? Math.abs(Math.floor(input.id)) % 2147483647
      : Math.floor(Date.now() % 2147483647)

  // 1) Direct Android NotificationManager via JS bridge
  try {
    const gn = gpthNative()
    if (gn && typeof gn.showNotification === "function") {
      const r = gn.showNotification(title, body, nid || 1)
      if (r === "ok" || (typeof r === "string" && !String(r).startsWith("error"))) {
        return true
      }
      console.warn("[native] GpthNative.showNotification", r)
    }
  } catch (e) {
    console.warn("[native] GpthNative notif", e)
  }

  // 2) Capacitor LocalNotifications
  const LN = plugin("LocalNotifications")
  if (!LN || typeof LN.schedule !== "function") return false
  try {
    await ensureNativeNotificationChannel()
    await LN.schedule({
      notifications: [
        {
          id: nid || 1,
          title,
          body,
          channelId: input.channelId || "gpth_attendance",
          sound: "default",
          smallIcon: "ic_stat_icon_config_sample",
          iconColor: "#1a4fa0",
          extra: { source: "gpth-student" },
        },
      ],
    })
    return true
  } catch (e) {
    console.warn("[native] schedule notification", e)
    try {
      await LN.schedule({
        notifications: [
          {
            id: nid || Math.floor(Date.now() % 2147483647),
            title,
            body,
            channelId: input.channelId || "gpth_attendance",
            sound: "default",
          },
        ],
      })
      return true
    } catch (e2) {
      console.warn("[native] schedule retry failed", e2)
      return false
    }
  }
}

/**
 * Save PDF base64 via Filesystem + open Android Share sheet.
 */
export async function saveAndSharePdfNative(
  base64: string,
  filename: string,
): Promise<"shared" | "saved" | null> {
  const safe = String(filename || "document.pdf")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 80)
  const path = safe.endsWith(".pdf") ? safe : `${safe}.pdf`
  const data = base64.includes(",") ? base64.split(",").pop() || base64 : base64

  // 1) Native Java bridge
  try {
    const bridge = gpthNative()
    if (bridge && typeof bridge.savePdfBase64 === "function") {
      const r = bridge.savePdfBase64(path, data)
      if (r === "ok" || (typeof r === "string" && r.indexOf("error:") !== 0)) {
        return "shared"
      }
    }
  } catch (e) {
    console.warn("[native] GpthNative save failed", e)
  }

  const FS = plugin("Filesystem")
  const Share = plugin("Share")
  if (!FS || typeof FS.writeFile !== "function") return null

  try {
    const written = await FS.writeFile({
      path,
      data,
      directory: "CACHE",
      recursive: true,
    })

    try {
      await FS.writeFile({
        path: `Download/${path}`,
        data,
        directory: "EXTERNAL_STORAGE",
        recursive: true,
      })
    } catch {
      try {
        await FS.writeFile({
          path,
          data,
          directory: "DOCUMENTS",
          recursive: true,
        })
      } catch {
        /* cache is enough */
      }
    }

    const uri =
      written?.uri ||
      (typeof FS.getUri === "function"
        ? (await FS.getUri({ path, directory: "CACHE" }))?.uri
        : null)

    if (Share && typeof Share.share === "function" && uri) {
      try {
        await Share.share({
          title: path,
          text: path,
          url: uri,
          dialogTitle: "Save or share PDF",
        })
        return "shared"
      } catch (e) {
        if (e && typeof e === "object" && "message" in e) {
          const msg = String((e as { message?: string }).message || "")
          if (/cancel|abort/i.test(msg)) return "shared"
        }
      }
    }

    return uri ? "saved" : null
  } catch (e) {
    console.warn("[native] save PDF failed", e)
    return null
  }
}

/** Convert a Blob to raw base64 (no data: prefix). */
export async function blobToBase64Raw(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const r = String(reader.result || "")
      const i = r.indexOf(",")
      resolve(i >= 0 ? r.slice(i + 1) : r)
    }
    reader.onerror = () => reject(new Error("read failed"))
    reader.readAsDataURL(blob)
  })
}
