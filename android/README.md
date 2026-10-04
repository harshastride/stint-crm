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

The debug app points at `http://10.0.2.2:3100` (the CRM on this computer, seen from the emulator). On a real phone, type the CRM's https address on the sign-in screen.

## CRM side
`POST /api/mobile/login`, `/api/mobile/refresh`, `GET /api/mobile/notes`, `POST /api/recordings/upload` (Bearer token). Server needs `DEEPGRAM_API_KEY` and `GEMINI_API_KEY`.
