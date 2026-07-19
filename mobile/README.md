# GPT Hubli Student — Android app

The student experience is the mobile web app at **`/student`**.

This folder is a **Capacitor** Android shell that opens:

`https://gpt-hubli-final.vercel.app/student`

(Change `server.url` in `capacitor.config.json` if your production host differs.)

## Install on phone without APK

1. Open Chrome on Android → `https://YOUR-HOST/student`
2. Menu → **Install app** / **Add to Home screen**

## Build debug APK (Windows)

### Requirements

- **JDK 17+** (not Java 8)
- **Android SDK** (platform-tools + build-tools + platform 34)
- Set `ANDROID_HOME` (or `ANDROID_SDK_ROOT`)

```powershell
cd mobile
npm install
npx cap add android
npx cap sync android
cd android
.\gradlew.bat assembleDebug
```

APK path:

`mobile/android/app/build/outputs/apk/debug/app-debug.apk`

Copy helper:

```powershell
npm run copy-apk
# -> mobile/dist/GPT-Hubli-Student-debug.apk
```

## GitHub Actions

Workflow: `.github/workflows/student-android-apk.yml`  
On `workflow_dispatch` or push to `main` (when `mobile/**` changes), it builds a debug APK and uploads it as an artifact named **`student-apk`**.

## First-time login (no OTP)

1. Register No. + temporary password  
2. Must set personal email + new password  
3. Then full app access  
