# Android companion app (backlog 4.4) — spec

Separate project, not in this repo. The CRM side is ready: `POST /api/recordings/upload`.

## What the app does

| # | Behaviour |
|---|---|
| 1 | Staff member signs in once with their CRM email; the admin pastes the incoming API key into the app (Automation log page → Incoming API key) |
| 2 | After each phone call, if the phone saved a call recording, the app shows a notification: "Upload call with +91 98xxxxxx?" |
| 3 | The staff member confirms they told the other person the call was recorded; only then is it uploaded (`consent=yes`) |
| 4 | Uploads on Wi-Fi or mobile data, retries if offline, deletes its local copy after a 201 answer |
| 5 | Never uploads personal calls: an allow-list switch per call, off by default for numbers saved in the phone's personal contacts |

## Upload call

```
POST https://<CRM address>/api/recordings/upload
x-api-key: <incoming API key>
multipart/form-data:
  audio         the recording file (m4a / mp3 / ogg / webm, up to 100 MB)
  staff_email   the signed-in staff member's CRM email
  number        the other phone number
  called_at     ISO time the call started
  duration_sec  call length in seconds
  direction     in | out
  consent       yes
```

Answers: `201 { recording_id, matched, processed }`, `400` (missing audio, no consent, unknown staff email), `401` (wrong key), `413` (too big).
The CRM matches the number to a lead or candidate; unmatched calls wait on the Recordings page. Transcripts and summaries are made on the server.

## Decisions still open

- Company or personal phones; Android only or iPhone too (iPhone does not allow call recording by apps).
- Android 10+ blocks apps from recording calls directly; the app must read recordings the phone's own dialer saves (Samsung, Xiaomi, OnePlus and Google Phone in India do this when call recording is switched on), so the phone model matters.
