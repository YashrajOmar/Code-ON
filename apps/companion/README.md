# CodeOn Companion

Desktop app that auto-syncs your competitive programming submissions to train your AI mentor on the CodeOn web app.

## Supported Platforms

| Platform | Auto-scrape | Login Verification |
|----------|------------|-------------------|
| Codeforces | Yes (API + code fetch) | Homepage profile link check |
| LeetCode | Yes (GraphQL API) | GraphQL userStatus query |
| AtCoder | Yes (API + code fetch) | Homepage logout link check |
| CodeChef | Login only | Homepage session check |
| HackerRank | Login only | REST API profile check |
| SPOJ | Login only | Homepage logout link check |

## How It Works

1. **Generate a Companion Token** on the CodeOn web app (Settings → Companion App Token → Generate)
2. Download `CodeOn Companion Setup.exe` and install
3. Paste your **Companion Token** into the app
4. Enter your handles (auto-detected after login — input is locked to prevent spoofing)
5. Click **Login** — Chrome opens visibly, log into the platform
6. Click **Check Login** — verifies your session by visiting the actual platform (not just cookies)
7. Handle is auto-filled and locked (readonly) — prevents scraping wrong user's submissions
8. Click **Sync Now** — scrapes your AC submissions, uploads to CodeOn

## Login Verification (Hybrid Approach)

The app uses a 2-step verification:

1. **Cookie Check (Fast)**: Checks if session cookies exist in `~/.codeon/browser-profile`. If no cookies → "Login Required" immediately (no browser page opened).
2. **Active Session Check (Accurate)**: If cookies exist, opens a lightweight page to verify the session is still valid:
   - Codeforces: Visits homepage, checks for profile link in header
   - LeetCode: GraphQL `userStatus` query (no full page load — avoids Cloudflare)
   - AtCoder: Visits homepage, checks for logout link
   - HackerRank: REST API profile check
   - CodeChef/SPOJ: Homepage session check

## Security Features

- **Handle Auto-Detection**: After login, the handle is extracted from the platform's website and locked (readonly). Users cannot type arbitrary handles.
- **Handle Sanitization**: Validates against `^[a-zA-Z0-9_\-\.]+$` regex before any API call.
- **Session Verification**: Never trusts cookie existence alone — always verifies with an active request.
- **Token Invalidation**: If the companion token is rejected by the server (401), it's cleared from local storage.
- **Per-Account Isolation**: All uploads are scoped to the authenticated user via the companion token.

## Sync Architecture

### Initial Sync (First Run)
- Scrapes up to 100 most recent AC submissions per platform
- LeetCode: Uses `recentAcSubmissions` GraphQL query (timestamp descending, not problem ID order)
- Codeforces: Uses `user.status` API, then scrapes submission pages for source code
- Batch processing: 20 submissions per batch, 2-minute pause between batches
- Randomized 3-7 second jitter between individual page loads

### Incremental Sync (Daily + Manual)
- Delta fetching: Only scrapes submissions newer than `lastSyncTimestamp`
- `lastSyncTimestamp` = max timestamp of successfully ingested items (decoupled from failed queue)
- Manual "Sync Now" button for immediate sync after contests

### Failed Queue & Retry Logic
- Failed submissions saved to `~/.codeon/sync-state.json` under `failedQueue`
- Processed FIRST on next sync (before new submissions)
- Items that fail 3 times across different sync runs are permanently removed
- `lastSyncTimestamp` does NOT advance until the queue is cleared (no silent data loss)

### Crash Recovery
- Resume index saved to `sync-state.json` after every batch
- If the app is killed at item 45, next boot resumes at item 46
- Batch uploads happen immediately after every 20-item chunk (not held in memory)

### Auto-Sync Cooldown
- If all platforms fail auth during auto-sync, a 5-minute cooldown is activated
- `isCoolingDown` boolean gates the auto-sync interval — no Playwright, no IPC during cooldown
- Manual sync bypasses cooldown (user is present)

## Code Execution

- Wandbox API (`gcc-head` compiler for C++)
- Compilation errors are surfaced (not silently dropped)
- Language parameter passed through from editor

## Clear All Local Data

The "Clear All Local Data" button deletes:
- `~/.codeon/companion-settings.json` (handles, token, URL)
- `~/.codeon/sync-state.json` (sync timestamps, failed queues, resume indices)
- `~/.codeon/browser-profile/` (Chrome profile with login sessions)
- `localStorage` (trained count cache)

The app reloads after clearing.

## For Developers

```bash
cd apps/companion
npm install
npx electron electron/main.js        # Run the app
npx electron-builder --win --x64     # Build installer (.exe)
```

### Settings & State

- `~/.codeon/companion-settings.json` — handles, CodeOn URL, companion token
- `~/.codeon/browser-profile/` — persistent Chrome profile (login sessions)
- `~/.codeon/sync-state.json` — last-sync timestamps, failed queues, resume indices per platform

## Architecture

- Electron desktop app with system tray
- Uses Playwright with persistent Chrome profile (bypasses Cloudflare)
- Login: visible Chrome window (user logs in manually)
- Sync: visible Chrome for manual sync, headless for auto-sync
- Auto-launch on Windows startup
- Auto-sync every 24 hours (plus a sync 60s after startup if handles are saved)
- Uploads via `POST /api/settings/seed-code` with Bearer token authentication

## Tech Stack

- **Electron 33** — desktop app framework
- **Playwright** — Chrome automation (persistent profile for session cookies)
- **Node.js fetch** — API calls to Codeforces/LeetCode/HackerRank
- **IPC** — Electron inter-process communication between main and renderer
- **Zustand** — state management (web app only, not companion)
