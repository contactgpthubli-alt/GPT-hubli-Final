# GPT Hubli Student — mobile apps (Android + iOS)

The student experience is the mobile web app at **`/student`**.

This folder is a **Capacitor** shell that opens:

`https://gpt-hubli-final.vercel.app/student`

(Change `server.url` in `capacitor.config.json` if your production host differs.)

## Android (current)

### Install without APK

1. Open Chrome on Android → `https://YOUR-HOST/student`
2. Menu → **Install app** / **Add to Home screen**

### Build debug APK (Windows)

Requirements: **JDK 17+**, Android SDK, `ANDROID_HOME`

```powershell
cd mobile
npm install
npx cap sync android
cd android
.\gradlew.bat assembleDebug
```

APK: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`  
Copy: `npm run copy-apk` → `mobile/dist/GPT-Hubli-Student-debug.apk`

## iPhone / iOS (possible — same codebase)

Yes. Capacitor can wrap the same student web app for iOS.

### What you need

1. **Mac** with **Xcode** (Apple does not allow iOS builds on Windows alone)
2. **Apple Developer Program** account (~$99/year) to install on real iPhones / App Store
3. CocoaPods (`sudo gem install cocoapods`)

### First-time iOS project

```bash
cd mobile
npm install
npx cap add ios
npx cap sync ios
npx cap open ios
```

In Xcode:

1. Select team / signing (your Apple Developer account)
2. Bundle ID e.g. `com.gpthubli.student`
3. Run on simulator or device
4. Archive → distribute for TestFlight / App Store when ready

The app still loads the live site (`server.url`), so most features update without a new App Store release (same as Android).

### Notifications note

- **While app is open** (or just opened): in-app + status-bar alerts work (Android APK).
- **When app is fully closed**: true push needs **Firebase Cloud Messaging (Android)** and **APNs (iOS)** — can be added later.

## First-time login (no OTP)

1. Register No. + temporary password  
2. Must set personal email + new password  
3. Choose **Student** or **Parent** once (remembered until logout)  
4. To switch role: **Logout → Login again → choose again**

## Feature updates (no APK rebuild for most)

The APK shell only opens the live site. After deploy, students should use **More → Update / refresh app** (or reinstall only when native plugins change).

| Area | In student app (`/student`) |
|------|-----------------------------|
| Profile, forms, certs, grievances, timetable | Yes |
| Notices, notifications, parent attendance | Yes |
| **Fees** (regular / makeup / admission + K2) | Yes (v1.6.0+) |
| Published semester results | Yes (view) |
| Self-entry of regular/makeup subject marks | Web portal Results desk (main site) |
| Staff modules | Main portal only |
