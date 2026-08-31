const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification } = require("electron");
const path = require("path");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("fs");
const { homedir } = require("os");

let mainWindow;
let tray = null;
let autoSyncTimer = null;
const SYNC_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

function createWindow() {
  const shouldHide = process.argv.includes("--hidden");

  mainWindow = new BrowserWindow({
    width: 560,
    height: 780,
    resizable: false,
    title: "CodeOn Companion",
    show: !shouldHide,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.setMenuBarVisibility(false);

  // Minimize to tray instead of quitting
  mainWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

// System tray
function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("CodeOn Companion");

  const contextMenu = Menu.buildFromTemplate([
    { label: "Open", click: () => mainWindow.show() },
    { label: "Sync Now", click: () => mainWindow.webContents.send("auto-sync") },
    { type: "separator" },
    { label: "Quit", click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(contextMenu);

  tray.on("click", () => mainWindow.show());
}

app.whenReady().then(() => {
  createWindow();
  createTray();

  // Start auto-sync timer
  startAutoSync();

  // Auto-launch on Windows startup
  app.setLoginItemSettings({
    openAtLogin: true,
    args: ["--hidden"],
  });
});

app.on("window-all-closed", (e) => {
  // Don't quit — stay in tray
});

let isQuitting = false;
app.on("before-quit", () => { isQuitting = true; });
app.isQuitting = false;

function startAutoSync() {
  if (autoSyncTimer) clearInterval(autoSyncTimer);
  autoSyncTimer = setInterval(() => {
    mainWindow.webContents.send("auto-sync");
  }, SYNC_INTERVAL);

  // Also sync 10 seconds after startup if handles are saved
  setTimeout(async () => {
    const settings = loadSettings();
    const hasHandles = settings.handles && Object.values(settings.handles).some(h => h && h.trim());
    if (hasHandles) {
      mainWindow.webContents.send("auto-sync");
    }
  }, 10000);
}

// ── Storage ────────────────────────────────────────────────────────────────
const SETTINGS_FILE = path.join(homedir(), ".codeon", "companion-settings.json");
const PROFILE_DIR = path.join(homedir(), ".codeon", "browser-profile");
const STATE_FILE = path.join(homedir(), ".codeon", "sync-state.json");

function loadSettings() {
  try {
    if (existsSync(SETTINGS_FILE)) return JSON.parse(readFileSync(SETTINGS_FILE, "utf-8"));
  } catch {}
  return { handles: {}, codeonUrl: "http://localhost:3000" };
}

function saveSettings(settings) {
  const dir = path.dirname(SETTINGS_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

function loadState() {
  try {
    if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch {}
  return {};
}

function saveState(state) {
  const dir = path.dirname(STATE_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ── Platforms ──────────────────────────────────────────────────────────────
const PLATFORMS = {
  codeforces: {
    name: "Codeforces",
    loginUrl: "https://codeforces.com/enter",
    apiSubmissions: (handle) => `https://codeforces.com/api/user.status?handle=${handle}&from=1&count=1000`,
    isAc: (s) => s.verdict === "OK",
    isCpp: (s) => s.programmingLanguage && s.programmingLanguage.includes("C++"),
    getCode: async (page, sub) => {
      const url = `https://codeforces.com/contest/${sub.problem.contestId}/submission/${sub.id}`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
      for (let i = 0; i < 10; i++) {
        const title = await page.title();
        if (!title.includes("Just a moment")) break;
        await page.waitForTimeout(2000);
      }
      const code = await page.locator("#program-source-text").textContent({ timeout: 5000 }).catch(() => null);
      return code;
    },
    problemName: (s) => s.problem.name,
    tags: (s) => s.problem.tags || [],
    timestamp: (s) => s.creationTimeSeconds,
  },
  leetcode: {
    name: "LeetCode",
    loginUrl: "https://leetcode.com/accounts/login/",
    apiSubmissions: null,
    isAc: null,
    isCpp: null,
    getCode: null,
    problemName: null,
    tags: null,
    timestamp: null,
  },
  atcoder: {
    name: "AtCoder",
    loginUrl: "https://atcoder.jp/login",
    apiSubmissions: (handle) => `https://atcoder.jp/users/${handle}/history/json`,
    isAc: (s) => s.Result === "AC",
    isCpp: (s) => s.Language && s.Language.includes("C++"),
    getCode: async (page, sub) => {
      const url = `https://atcoder.jp/contests/${sub.ContestScreenName}/submissions/${sub.SubmissionId}`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
      const code = await page.locator("pre").first().textContent({ timeout: 5000 }).catch(() => null);
      return code;
    },
    problemName: (s) => s.TaskName || s.TaskScreenName || "Unknown",
    tags: () => [],
    timestamp: (s) => s.EpochSecond,
  },
  codechef: {
    name: "CodeChef",
    loginUrl: "https://www.codechef.com/login",
    apiSubmissions: null,
    isAc: null,
    isCpp: null,
    getCode: null,
    problemName: null,
    tags: null,
    timestamp: null,
  },
  hackerrank: {
    name: "HackerRank",
    loginUrl: "https://www.hackerrank.com/login",
    apiSubmissions: null,
    isAc: null,
    isCpp: null,
    getCode: null,
    problemName: null,
    tags: null,
    timestamp: null,
  },
  spoj: {
    name: "SPOJ",
    loginUrl: "https://www.spoj.com/login/",
    apiSubmissions: null,
    isAc: null,
    isCpp: null,
    getCode: null,
    problemName: null,
    tags: null,
    timestamp: null,
  },
};

// ── IPC ────────────────────────────────────────────────────────────────────

ipcMain.handle("get-settings", () => loadSettings());
ipcMain.handle("save-settings", (_, settings) => saveSettings(settings));

let browserContext = null;

async function getBrowser() {
  if (browserContext) {
    try {
      // Check if context is still alive
      await browserContext.pages();
    } catch {
      browserContext = null;
    }
  }
  
  if (!browserContext) {
    const { chromium } = require("playwright");
    if (!existsSync(PROFILE_DIR)) mkdirSync(PROFILE_DIR, { recursive: true });
    
    // Clear any leftover Chrome lock files
    const lockFiles = ["SingletonLock", "SingletonCookie", "SingletonSocket", "Default/LOCK"];
    for (const lock of lockFiles) {
      const lockPath = path.join(PROFILE_DIR, lock);
      try { if (existsSync(lockPath)) require("fs").unlinkSync(lockPath); } catch {}
    }
    
    browserContext = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: false,
      channel: "chrome",
      viewport: null,
      args: ["--start-maximized", "--disable-blink-features=AutomationControlled"],
      ignoreDefaultArgs: ["--enable-automation"],
    });

    // Don't close on window close — keep alive for sync
    // Only close when app quits
  }
  
  return browserContext;
}

ipcMain.handle("login", async (_, { platform }) => {
  try {
    const p = PLATFORMS[platform];
    if (!p) return { success: false, error: "Unknown platform" };

    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.goto(p.loginUrl, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});

    mainWindow.webContents.send("status", `Chrome opened. Please log into ${p.name}, then close the browser tab when done.`);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("checkConnection", async (_, { codeonUrl }) => {
  try {
    const res = await fetch(`${codeonUrl}/api/settings`, { signal: AbortSignal.timeout(5000) });
    return { connected: res.ok };
  } catch {
    return { connected: false };
  }
});

ipcMain.handle("sync", async (_, { handles, codeonUrl }) => {
  const state = loadState();
  const results = { total: 0, perPlatform: {}, errors: [] };

  try {
    const browser = await getBrowser();
    const page = await browser.newPage();

    for (const [platform, handle] of Object.entries(handles)) {
      if (!handle || !handle.trim()) continue;
      const p = PLATFORMS[platform];
      if (!p || !p.apiSubmissions) {
        results.perPlatform[platform] = { status: "not_supported", count: 0 };
        continue;
      }

      mainWindow.webContents.send("status", `Fetching ${p.name} submissions for ${handle}...`);

      try {
        const lastSync = state[`${platform}LastSync`] || 0;
        const isFirstSync = lastSync === 0;
        const targetCount = isFirstSync ? 500 : 15;
        const allAcSubs = [];
        let from = 1;
        const pageSize = 1000;
        let hasMore = true;
        let pagesFetched = 0;

        // Keep fetching pages until we have enough AC solutions or run out
        while (allAcSubs.length < targetCount && hasMore && pagesFetched < 10) {
          mainWindow.webContents.send("status", `Fetching ${p.name} page ${pagesFetched + 1}... (found ${allAcSubs.length} AC so far)`);

          if (platform === "codeforces") {
            const apiUrl = `https://codeforces.com/api/user.status?handle=${handle}&from=${from}&count=${pageSize}`;
            await page.goto(apiUrl, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
            const apiText = await page.locator("pre").textContent().catch(() => "{}");
            let apiData;
            try { apiData = JSON.parse(apiText); } catch { hasMore = false; break; }

            if (!apiData || apiData.status !== "OK") {
              // Check login
              const profileUrl = `https://codeforces.com/profile/${handle}`;
              await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});
              const pageText = await page.locator("body").textContent().catch(() => "");
              if (pageText.includes("Log in") || pageText.includes("Sign in")) {
                new Notification({
                  title: "CodeOn Companion — Login Expired",
                  body: `Your ${p.name} session has expired. Click the Login button to log in again.`,
                  silent: false,
                }).show();
                mainWindow.webContents.send("status", `LOGIN EXPIRED for ${p.name}. Please click the Login button to re-login.`);
                results.perPlatform[platform] = { status: "login_expired", count: 0 };
                results.errors.push(`${p.name}: Login expired. Click Login to re-authenticate.`);
                hasMore = false;
                break;
              }
              hasMore = false;
              break;
            }

            const pageSubs = apiData.result;
            if (!pageSubs || pageSubs.length === 0) { hasMore = false; break; }

            // Filter AC + C++ + newer than last sync
            const acSubs = pageSubs.filter(s => p.isAc(s) && p.isCpp(s) && p.timestamp(s) > lastSync);
            allAcSubs.push(...acSubs);

            // Check if oldest submission in this page is older than lastSync — if so, stop
            const oldest = pageSubs[pageSubs.length - 1];
            if (oldest && p.timestamp(oldest) <= lastSync) {
              hasMore = false;
            }

            from += pageSize;
          } else if (platform === "atcoder") {
            await page.goto(p.apiSubmissions(handle), { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
            const apiText = await page.locator("pre").textContent().catch(() => "[]");
            let apiData;
            try { apiData = JSON.parse(apiText); } catch { hasMore = false; break; }
            if (!apiData || apiData.length === 0) { hasMore = false; break; }
            const acSubs = apiData.filter(s => p.isAc(s) && p.isCpp(s) && p.timestamp(s) > lastSync);
            allAcSubs.push(...acSubs);
            hasMore = false; // AtCoder doesn't support pagination
          } else {
            hasMore = false;
            break;
          }

          pagesFetched++;
          // Rate limit between pages
          await new Promise(r => setTimeout(r, 1000));
        }

        const newSubs = allAcSubs.slice(0, targetCount);
        mainWindow.webContents.send("status", `Found ${newSubs.length} AC ${p.name} submissions across ${pagesFetched} page(s).`);

        const solutions = [];
        for (const sub of newSubs) {
          mainWindow.webContents.send("status", `Fetching code: ${p.problemName(sub)}`);
          try {
            const code = await p.getCode(page, sub);
            if (code && code.trim().length > 20) {
              solutions.push({
                code: code.trim(),
                problemTitle: p.problemName(sub),
                platform,
                tags: p.tags(sub),
              });
            }
            await page.waitForTimeout(1000);
          } catch (e) {
            results.errors.push(`${p.name} ${p.problemName(sub)}: ${e.message}`);
          }
        }

        if (solutions.length > 0) {
          mainWindow.webContents.send("status", `Uploading ${solutions.length} ${p.name} solutions...`);
          try {
    const webhookSecret = "codeon-companion-secret";
    const res = await fetch(`${codeonUrl}/api/settings/seed-code`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${webhookSecret}`,
      },
      body: JSON.stringify({ solutions }),
    });
            const data = await res.json();
            if (data.success) {
              results.total += solutions.length;
              results.perPlatform[platform] = { status: "done", count: solutions.length };
              mainWindow.webContents.send("status", `${p.name}: ${solutions.length} solutions uploaded.`);
            }
          } catch (e) {
            results.errors.push(`${p.name} upload failed: ${e.message}`);
            results.perPlatform[platform] = { status: "upload_error", count: 0 };
          }
        } else {
          results.perPlatform[platform] = { status: "done", count: 0 };
        }

        state[`${platform}LastSync`] = Math.floor(Date.now() / 1000);
      } catch (e) {
        results.errors.push(`${p.name}: ${e.message}`);
        results.perPlatform[platform] = { status: "error", count: 0 };
      }
    }

    saveState(state);
    results.status = "done";
    return results;
  } catch (e) {
    results.errors.push(e.message);
    results.status = "error";
    return results;
  }
});

app.on("before-quit", () => {
  if (browserContext) browserContext.close();
});
