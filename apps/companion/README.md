# CodeOn Companion

Auto-syncs your Codeforces/LeetCode submissions to train your AI mentor.

## Quick Start

```bash
# Install
cd apps/companion
npm install

# First run — opens browser to log into CF/LC
CF_HANDLE=your_handle LC_HANDLE=your_handle node src/index.js --login-only

# Sync once
CF_HANDLE=your_handle LC_HANDLE=your_handle node src/index.js

# Or run continuously (daily auto-sync)
CF_HANDLE=your_handle node src/index.js
```

## How It Works

1. Opens a real Chrome browser (not headless — this bypasses Cloudflare)
2. You log into CF/LC once — session is saved locally in `~/.codeon/browser-profile`
3. Scrapes your AC submission source code
4. Posts code to CodeOn's RAG pipeline
5. Auto-syncs daily (only new submissions)

## Package as exe

```bash
npm run build
# Creates codeon-companion.exe (Windows)
```
