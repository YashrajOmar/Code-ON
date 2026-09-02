# CodeOn Companion

Desktop app that auto-syncs your competitive programming submissions to train your AI mentor on the CodeOn web app.

## Supported Platforms

| Platform | Auto-scrape | Login only |
|----------|------------|------------|
| Codeforces | Yes (API + code fetch) | |
| LeetCode | Yes (GraphQL + page scrape) | |
| AtCoder | Yes (API + code fetch) | |
| CodeChef | | Yes |
| HackerRank | | Yes |
| SPOJ | | Yes |

Login-only platforms can be logged into but code scraping is not yet implemented.

## How It Works

1. **Generate a Companion Token** on the CodeOn web app (Settings → Companion App Token → Generate)
2. Download `CodeOn Companion Setup.exe` and install
3. Paste your **Companion Token** into the app
4. Enter your handles (e.g. Codeforces `Korosuke_12`)
5. Click **Login** — Chrome opens visibly, log into the platform, then close the tab
6. Click **Sync Now** — Chrome runs in background, scrapes your AC submissions, uploads to CodeOn
7. Done — the app stays in your system tray and auto-syncs every 24 hours

## Important Notes

- **Companion Token is required** — without it, synced data goes to a demo account and won't appear under your real account on the website. Generate one in Settings → Companion App Token.
- **During sync, don't close the app** — sync runs in a background Chrome window. Closing the app stops the sync.
- **After first sync, the app auto-syncs every 24 hours** — you don't need to do anything.
- **Your login is saved locally** in `~/.codeon/browser-profile` — never shared.
- **First sync scrapes up to 500 AC submissions** (Codeforces) — subsequent syncs only fetch new ones.
- **If your login expires** — you'll get a notification. Click Login again, log into the platform, then click Sync Now.
- **Codeforces "no code" skips** — if you see submissions skipped with "(no code)", your Codeforces login session has expired. Click Login, log in, then Sync Now.

## Troubleshooting

### "Cannot reach CodeOn"
- Check your internet connection
- Verify the **CodeOn Server** URL in the app matches the web app URL
- Ensure the CodeOn web app is deployed and running
- If using a custom deployment, update the CodeOn Server URL field

### Synced data not visible on website
- Make sure you generated and pasted a **Companion Token** — without it, data goes to a demo account
- Check the web app Dashboard → "Trained Solutions" section shows your synced submissions
- Check Settings → "Train Your AI Mentor" → "Trained Solutions" for the full list

### Chrome won't open / login issues
- The app uses a separate Chrome profile at `~/.codeon/browser-profile`
- If Chrome is stuck, delete `~/.codeon/browser-profile` and relaunch
- Don't use your personal Chrome while the companion Chrome is running with the same profile

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
- `~/.codeon/sync-state.json` — last-sync timestamps per platform

## Architecture

- Electron desktop app with system tray
- Uses Playwright with persistent Chrome profile (bypasses Cloudflare)
- Login: visible Chrome window (user logs in)
- Sync: background Chrome window (Cloudflare sees real browser, user sees nothing)
- Auto-launch on Windows startup
- Auto-sync every 24 hours (plus a sync 60s after startup if handles are saved)
- Uploads via `POST /api/settings/seed-code` with Bearer token authentication
