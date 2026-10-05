# Stint Notes (Android)

Records conversations on the phone's mic, like a voice-notes app. The CRM makes the transcript (Deepgram) and summary (Gemini).

| Step | What happens |
|---|---|
| Sign in | Same CRM email and password. Only active staff. |
| Start Now | Tick "I told the other person… they agreed" (required). Optional: their mobile, to link the note to the lead or student. |
| Recording | Keeps going with the screen off; Stop is also in the notification. |
| Stop and save | Uploads straight away, or later when there is internet. The phone copy is deleted once the CRM has it. |
| Your notes | Your own notes only, with summary, next step and transcript. |

## Build

| Do | Command (in `android/`) |
|---|---|
| Test APK | `./gradlew assembleDebug` → `app/build/outputs/apk/debug/app-debug.apk` |
| Release APK | Add `keystore.properties` (storeFile, storePassword, keyAlias, keyPassword), then `./gradlew assembleRelease` |

The app signs in to https://crm.skillxen.com. For testing against a computer running the CRM, tap "Use a different CRM address" on the sign-in screen (emulator: `http://10.0.2.2:3100`; phone on the same Wi-Fi: the computer's address, port 3100; only the debug APK allows plain http).

## CRM side
`POST /api/mobile/login`, `/api/mobile/refresh`, `GET /api/mobile/notes`, `POST /api/recordings/upload` (Bearer token). Server needs `DEEPGRAM_API_KEY` and `GEMINI_API_KEY`.
