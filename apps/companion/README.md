# CodeOn Companion

Auto-syncs your Codeforces/LeetCode submissions to train your AI mentor.

## How It Works

1. Download `CodeOn Companion Setup.exe`
2. Double-click to install — opens automatically
3. Enter your Codeforces handle (e.g. `Korosuke_12`)
4. Click **Login** — Chrome opens visibly, log into Codeforces, close the tab
5. Click **Sync Now** — Chrome runs invisibly in background, scrapes your AC submissions, uploads to CodeOn
6. Done — the app stays in your system tray and auto-syncs every 24 hours

## Important Notes

- **During sync, don't close the app** — the sync runs in background Chrome (off-screen). If you close the app, sync stops.
- **After first sync, the app auto-syncs every 24 hours** — you don't need to do anything.
- **Your login is saved locally** in `~/.codeon/browser-profile` — never shared.
- **Only Codeforces supports auto-scrape** — LeetCode/AtCoder/CodeChef login is available but code scraping requires visiting each submission page manually.
- **First sync scrapes up to 500 AC submissions** — subsequent syncs only fetch new ones.
- **If your login expires** — you'll get a notification. Click Login again, log into the platform, then click Sync Now.

## For Developers

```bash
cd apps/companion
npm install
npx electron electron/main.js        # Run the app
npx electron-builder --win --x64     # Build installer (.exe)
```

## Architecture

- Electron desktop app with system tray
- Uses Playwright with persistent Chrome profile (bypasses Cloudflare)
- Login: visible Chrome window (user logs in)
- Sync: off-screen Chrome window (Cloudflare sees real browser, user sees nothing)
- Auto-launch on Windows startup
- Auto-sync every 24 hours
