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
    icon: path.join(__dirname, "icon.png"),
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
  const icon = nativeImage.createFromPath(path.join(__dirname, "icon.png"));
  const resizedIcon = icon.resize({ width: 16, height: 16 });
  tray = new Tray(resizedIcon);
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

// ── Auto-sync cooldown (strict boolean gate) ─────────────────────────────────
let isCoolingDown = false;

function startAutoSync() {
  if (autoSyncTimer) clearInterval(autoSyncTimer);
  autoSyncTimer = setInterval(() => {
    // STRICT GATE: if cooling down, do nothing at all — no Playwright, no IPC
    if (isCoolingDown) return;
    mainWindow.webContents.send("auto-sync");
  }, SYNC_INTERVAL);

  // Also sync 60 seconds after startup if handles are saved
  setTimeout(async () => {
    if (isCoolingDown) return;
    const settings = loadSettings();
    const hasHandles = settings.handles && Object.values(settings.handles).some(h => h && h.trim());
    if (hasHandles) {
      mainWindow.webContents.send("auto-sync");
    }
    }, 60000);
}

// ── Storage ────────────────────────────────────────────────────────────────
const SETTINGS_FILE = path.join(homedir(), ".codeon", "companion-settings.json");
const PROFILE_DIR = path.join(homedir(), ".codeon", "browser-profile");
const STATE_FILE = path.join(homedir(), ".codeon", "sync-state.json");

function loadSettings() {
  try {
    if (existsSync(SETTINGS_FILE)) return JSON.parse(readFileSync(SETTINGS_FILE, "utf-8"));
  } catch {}
  return { handles: {}, codeonUrl: "https://codeon-coding-coach-eight.vercel.app", companionToken: "" };
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
      const contestId = sub.problem.contestId;
      const submissionUrl = contestId >= 100000
        ? `https://codeforces.com/gym/${contestId}/submission/${sub.id}`
        : `https://codeforces.com/contest/${contestId}/submission/${sub.id}`;
      await page.goto(submissionUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
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
    // LeetCode doesn't have a public API for code — we scrape the submissions page
    apiSubmissions: null, // null means we use page scraping instead of API
    isAc: null,
    isCpp: null,
    getCode: null,
    problemName: null,
    tags: null,
    timestamp: null,
    // Custom scraper for LeetCode
    scrape: async (page, handle, lastSync, targetCount, sendStatus) => {
      const solutions = [];

      sendStatus(`[LeetCode] Loading LeetCode for ${handle}...`);
      await page.goto(`https://leetcode.com/`, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(3000);

      // Step 1: Get RECENT accepted submissions (timestamp descending, not by problem ID)
      sendStatus(`[LeetCode] Fetching recent accepted submissions...`);

      const recentSubs = await page.evaluate(async (params) => {
        const { userSlug, limit } = params;
        try {
          const res = await fetch("https://leetcode.com/graphql", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: `query recentAcSubmissionList($userSlug: String!, $limit: Int!) {
                recentAcSubmissions(userSlug: $userSlug, limit: $limit) {
                  id title titleSlug timestamp lang { name }
                }
              }`,
              variables: { userSlug: userSlug, limit: limit },
            }),
          });
          const data = await res.json();
          return data?.data?.recentAcSubmissions || [];
        } catch (e) {
          try {
            const res2 = await fetch("https://leetcode.com/graphql", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                query: `query userProfileQuestionsStatus($status: StatusFilterEnum!, $limit: Int, $skip: Int, $sortField: SortFieldEnum!, $sortOrder: SortingOrderEnum!, $userSlug: String!) {
                  userProfileQuestionsStatus(status: $status, limit: $limit, skip: $skip, sortField: $sortField, sortOrder: $sortOrder, userSlug: $userSlug) {
                    id title titleSlug difficulty
                  }
                }`,
                variables: { status: "ACCEPTED", limit: limit, skip: 0, sortField: "LAST_SUBMITTED_AT", sortOrder: "DESCENDING", userSlug: userSlug },
              }),
            });
            const data2 = await res2.json();
            return data2?.data?.userProfileQuestionsStatus || [];
          } catch (e2) {
            return [];
          }
        }
      }, { userSlug: handle, limit: targetCount });

      if (recentSubs.length === 0) {
        sendStatus(`[LeetCode] No recent submissions found. Try logging in again.`);
        return [];
      }

      sendStatus(`[LeetCode] Found ${recentSubs.length} recent AC submissions. Fetching code...`);

      // Step 2: For each recent submission, get the actual code
      const limit = Math.min(recentSubs.length, targetCount);

      for (let i = 0; i < limit; i++) {
        const prob = recentSubs[i];
        sendStatus(`[LeetCode] Scraping ${i + 1}/${limit}: ${prob.title}`);

        try {
          const codeResult = await page.evaluate(async (subId) => {
            try {
              const detailRes = await fetch("https://leetcode.com/graphql", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  query: 'query submissionDetails($submissionId: Int!) { submissionDetails(submissionId: $submissionId) { code lang { name } statusCode statusDisplay } }',
                  variables: { submissionId: parseInt(subId) },
                }),
              });
              const detailData = await detailRes.json();
              const detail = detailData?.data?.submissionDetails;
              if (detail && detail.code && detail.code.trim().length > 20) {
                return { code: detail.code.trim() };
              }
            } catch (e) {}
            return null;
          }, prob.id).catch(() => null);

          if (codeResult && codeResult.code) {
            solutions.push({ code: codeResult.code, problemTitle: prob.title, platform: "leetcode", tags: prob.tags || [] });
            sendStatus(`[LeetCode] Scraped ${i + 1}/${limit}: ${prob.title} ✓`);
          } else {
            sendStatus(`[LeetCode] Skipped ${i + 1}/${limit} (no code)`);
          }

          // Randomized jitter: 3-7 seconds between requests
          const jitter = 3000 + Math.floor(Math.random() * 4000);
          await page.waitForTimeout(jitter);
        } catch (e) {
          sendStatus(`[LeetCode] Skipped ${i + 1}/${limit} (error: ${e.message})`);
        }
      }

      return solutions;
    },
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

async function killChromeAndClearLocks() {
  const { execSync } = require("child_process");
  const fs = require("fs");
  
  // Only kill Chrome processes using OUR profile — don't kill user's personal Chrome
  try {
    // Use PowerShell instead of wmic (not available on all Windows versions)
    const output = execSync('powershell -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'chrome.exe\'\\" | Select-Object ProcessId,CommandLine | Format-Table -AutoSize | Out-String"', { encoding: 'utf-8', timeout: 5000 });
    const lines = output.split('\n');
    for (const line of lines) {
      if (line.includes('.codeon') && line.includes('browser-profile')) {
        const match = line.match(/(\d+)/);
        if (match) {
          try { execSync(`taskkill /F /PID ${match[1]}`, { stdio: "ignore" }); } catch {}
        }
      }
    }
  } catch {}
  
  await new Promise(r => setTimeout(r, 1500));
  
  // Clear lock files in our profile only
  const lockFiles = ["SingletonLock", "SingletonCookie", "SingletonSocket", "Default/LOCK", "Default/SingletonLock"];
  for (const lock of lockFiles) {
    try { if (fs.existsSync(path.join(PROFILE_DIR, lock))) fs.unlinkSync(path.join(PROFILE_DIR, lock)); } catch {}
  }
}

async function getBrowser(visible) {
  if (browserContext) {
    try {
      await browserContext.pages();
      return browserContext;
    } catch {
      browserContext = null;
    }
  }
  
  const { chromium } = require("playwright");
  if (!existsSync(PROFILE_DIR)) mkdirSync(PROFILE_DIR, { recursive: true });
  
  await killChromeAndClearLocks();
  
  const args = ["--disable-blink-features=AutomationControlled", "--start-maximized"];
  const isHeadless = visible === false;
  
  try {
    browserContext = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: isHeadless,
      channel: "chrome",
      viewport: isHeadless ? { width: 1280, height: 800 } : null,
      args,
      ignoreDefaultArgs: ["--enable-automation"],
    });
  } catch (e) {
    await killChromeAndClearLocks();
    browserContext = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: isHeadless,
      channel: "chrome",
      viewport: isHeadless ? { width: 1280, height: 800 } : null,
      args,
      ignoreDefaultArgs: ["--enable-automation"],
    });
  }
  
  return browserContext;
}

// ── Handle Validation ──────────────────────────────────────────────────────
ipcMain.handle("validate-handle", async (_, { platform, handle }) => {
  try {
    if (platform === "codeforces") {
      const res = await fetch(`https://codeforces.com/api/user.info?handles=${handle}`);
      if (!res.ok) return { valid: false, error: `HTTP ${res.status}` };
      const data = await res.json();
      return { valid: data.status === "OK", error: data.status === "OK" ? undefined : data.comment || "Handle not found" };
    }
    if (platform === "leetcode") {
      const res = await fetch("https://leetcode.com/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `query userProfile($username: String!) { matchedUser(username: $username) { username } }`,
          variables: { username: handle },
        }),
      });
      if (!res.ok) return { valid: false, error: `HTTP ${res.status}` };
      const data = await res.json();
      return { valid: data?.data?.matchedUser?.username === handle, error: undefined };
    }
    if (platform === "atcoder") {
      const res = await fetch(`https://atcoder.jp/users/${handle}/history/json`);
      return { valid: res.ok, error: res.ok ? undefined : "Handle not found" };
    }
    if (platform === "codechef") {
      const res = await fetch(`https://www.codechef.com/users/${handle}`);
      return { valid: res.ok, error: res.ok ? undefined : "Handle not found" };
    }
    if (platform === "hackerrank") {
      const res = await fetch(`https://www.hackerrank.com/rest/contests/master/hacker/${handle}/profile`);
      if (!res.ok) return { valid: false, error: "Handle not found" };
      const data = await res.json();
      return { valid: data?.status === true, error: undefined };
    }
    if (platform === "spoj") {
      const res = await fetch(`https://www.spoj.com/users/${handle}/`);
      return { valid: res.ok, error: res.ok ? undefined : "Handle not found" };
    }
    // Unknown platform — allow it
    return { valid: true, error: undefined };
  } catch (e) {
    // CRITICAL: Always return a resolved object, NEVER throw — prevents IPC hang
    return { valid: false, error: e?.message || "Network error" };
  }
});

// ── Check Login Status (cookie verification) ────────────────────────────────

// Shared session cookie map for all platforms
const SESSION_COOKIE_MAP = {
  codeforces: ['X-User-Sn', 'rc', 'CF_ORG_ID'],
  leetcode: ['LEETCODE_SESSION', 'csrftoken'],
  atcoder: ['REVEL_SESSION', 'ARBCID'],
  codechef: ['session', 'CCA'],
  hackerrank: ['_hrank_session', 'hackajob_session'],
  spoj: ['SPOJ_SESSION', 'spoj_session'],
};

async function checkCookiesForPlatform(platform) {
  // Read cookies from existing browserContext ONLY.
  // Never launch a temp context — it conflicts with the profile lock
  // if Chrome is already running, and crashes if it's not.
  if (!browserContext) {
    return { loggedIn: false };
  }

  let cookies = [];
  try {
    cookies = await browserContext.cookies();
  } catch {
    return { loggedIn: false };
  }

  const required = SESSION_COOKIE_MAP[platform];
  if (!required || required.length === 0) {
    return { loggedIn: false };
  }

  const foundCookies = cookies.filter(c => required.some(r => c.name === r));
  const hasSession = foundCookies.length > 0;

  console.log(`[LoginCheck] ${platform}: ${cookies.length} total cookies, ${foundCookies.length} session cookies, names: [${foundCookies.map(c => c.name).join(', ')}] → loggedIn: ${hasSession}`);

  return { loggedIn: hasSession };
}

ipcMain.handle("check-login-status", async (_, { platform }) => {
  try {
    const result = await checkCookiesForPlatform(platform);

    // If logged in, purge the failed queue for this platform
    if (result.loggedIn) {
      const state = loadState();
      const failedQueueKey = `${platform}FailedQueue`;
      if (state[failedQueueKey] && state[failedQueueKey].length > 0) {
        state[failedQueueKey] = [];
        saveState(state);
      }
    }

    return result;
  } catch (e) {
    console.error(`[LoginCheck] ${platform}: Error:`, e.message);
    return { loggedIn: false };
  }
});

// ── Clear All Local Data ────────────────────────────────────────────────────
ipcMain.handle("clear-local-data", async () => {
  try {
    if (browserContext) {
      try { await browserContext.close(); } catch {}
      browserContext = null;
    }
    
    const fs = require("fs");
    const codeonDir = path.join(homedir(), ".codeon");
    
    try { if (existsSync(SETTINGS_FILE)) fs.unlinkSync(SETTINGS_FILE); } catch {}
    try { if (existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE); } catch {}
    try { if (existsSync(PROFILE_DIR)) fs.rmSync(PROFILE_DIR, { recursive: true, force: true }); } catch {}
    
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("login", async (_, { platform }) => {
  try {
    const p = PLATFORMS[platform];
    if (!p) return { success: false, error: "Unknown platform" };

    // Don't close existing browser — just open a new tab in it
    // This way sync continues running while user logs in
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.goto(p.loginUrl, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});

    mainWindow.webContents.send("status", `[${p.name}] New tab opened. Log in, then close the tab. Sync continues in background.`);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("checkConnection", async (_, { codeonUrl, companionToken }) => {
  try {
    // Check server reachability via a public route
    const res = await fetch(`${codeonUrl}/api/companion`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    const connected = res.ok || res.status === 400 || res.status === 405;

    // If we have a token, also validate it by hitting the token route
    if (connected && companionToken && companionToken.trim()) {
      try {
        const tokenRes = await fetch(`${codeonUrl}/api/settings/seed-code`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${companionToken.trim()}`,
          },
          body: JSON.stringify({ solutions: [] }),
          signal: AbortSignal.timeout(5000),
        });
        // 400 = token valid (empty solutions rejected), 401 = invalid token
        if (tokenRes.status === 401) {
          return { connected: false, tokenValid: false };
        }
      } catch {}
    }

    return { connected, tokenValid: true };
  } catch {
    return { connected: false };
  }
});

ipcMain.handle("sync", async (_, { handles, codeonUrl, companionToken, isAutoSync }) => {
  const state = loadState();
  const results = { total: 0, perPlatform: {}, errors: [] };

  if (!companionToken || !companionToken.trim()) {
    mainWindow.webContents.send("status", "ERROR: No Companion Token set. Sync aborted.");
    results.errors.push("No Companion Token — sync aborted.");
    results.status = "error";
    return results;
  }

  const authToken = companionToken.trim();

  // ── AUTH GATE: Check cookies from EXISTING browserContext only ────────────
  // Do NOT call getBrowser() or newPage() here. If no browser exists, we
  // can't check cookies -> assume not logged in -> skip all platforms.
  const platformCookieMap = {
    codeforces: ['CF_ORG_ID', 'X-User-Sn', 'rc'],
    leetcode: ['LEETCODE_SESSION', 'csrftoken'],
    atcoder: ['REVEL_SESSION', 'ARBCID'],
  };

  let allAuthFailed = true;
  const authenticatedPlatforms = new Set();
  let cookies = [];

  // Read cookies from existing browserContext ONLY.
  // Do NOT launch a temp headless context here — it conflicts with visible Chrome
  // if the user clicked Login. If no browser is open, all platforms skip.
  if (browserContext) {
    try {
      cookies = await browserContext.cookies();
    } catch {
      cookies = [];
    }
  }

  for (const [platform, handle] of Object.entries(handles)) {
    if (!handle || !handle.trim()) continue;
    const required = SESSION_COOKIE_MAP[platform];
    if (!required || required.length === 0) {
      continue;
    }
    const hasSession = cookies.some(c => required.some(r => c.name === r));
    if (hasSession) {
      authenticatedPlatforms.add(platform);
      allAuthFailed = false;
    } else {
      const p = PLATFORMS[platform];
      mainWindow.webContents.send("status", `[${p?.name || platform}] Skipped sync: Login required.`);
      results.perPlatform[platform] = { status: "login_required", count: 0 };
    }
  }

  // If all platforms failed auth, activate cooldown for auto-sync
  if (allAuthFailed) {
    if (isAutoSync) {
      isCoolingDown = true;
      mainWindow.webContents.send("status", "All platforms need login. Auto-sync paused for 5 minutes.");
      // Release cooldown after 5 minutes
      setTimeout(() => { isCoolingDown = false; }, 5 * 60 * 1000);
    }
    results.status = "done";
    return results;
  }

  // ── Only now create a page (after auth verified) ────────────────────────────
  try {
    const browser = await getBrowser(!isAutoSync); // visible for manual, headless for auto
    const page = await browser.newPage();

    for (const [platform, handle] of Object.entries(handles)) {
      if (!handle || !handle.trim()) continue;
      // Skip platforms that failed auth check
      if (!authenticatedPlatforms.has(platform)) continue;

      const p = PLATFORMS[platform];
      if (!p) {
        results.perPlatform[platform] = { status: "not_supported", count: 0 };
        continue;
      }

      // LeetCode uses custom scraper (no public API)
      if (p.scrape) {
        mainWindow.webContents.send("status", `[${p.name}] Starting scrape for ${handle}...`);
        try {
          const lastSync = state[`${platform}LastSync`] || 0;
          const isFirstSync = lastSync === 0;
          const targetCount = isFirstSync ? 100 : 15;

          const solutions = await p.scrape(page, handle, lastSync, targetCount, (msg) => {
            mainWindow.webContents.send("status", msg);
          });

          if (solutions.length > 0) {
            mainWindow.webContents.send("status", `[${p.name}] Uploading ${solutions.length} solutions...`);
            try {
              const res = await fetch(`${codeonUrl}/api/settings/seed-code`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${authToken}`,
                },
                body: JSON.stringify({ solutions }),
              });
              if (res.status === 401) {
                const settings = loadSettings();
                settings.companionToken = "";
                saveSettings(settings);
                mainWindow.webContents.send("status", "ERROR: Companion token is invalid. Generate a new one in web app Settings. Sync aborted.");
                results.errors.push("Companion token invalid — sync aborted.");
                results.status = "error";
                return results;
              }
              const resText = await res.text();
              let data;
              try { data = JSON.parse(resText); } catch {
                results.errors.push(`${p.name} upload failed: server returned non-JSON`);
                results.perPlatform[platform] = { status: "upload_error", count: 0 };
              }
              if (data && data.success) {
                results.total += solutions.length;
                results.perPlatform[platform] = { status: "done", count: solutions.length };
                mainWindow.webContents.send("status", `[${p.name}] ${solutions.length} solutions uploaded ✓`);
              } else if (data) {
                results.errors.push(`${p.name} upload failed: ${data.error || "Unknown"}`);
                results.perPlatform[platform] = { status: "upload_error", count: 0 };
              }
            } catch (e) {
              results.errors.push(`${p.name} upload failed: ${e.message}`);
              results.perPlatform[platform] = { status: "upload_error", count: 0 };
            }
          } else {
            results.perPlatform[platform] = { status: "done", count: 0 };
            mainWindow.webContents.send("status", `[${p.name}] No submissions found.`);
          }

          if (solutions.length > 0) {
            state[`${platform}LastSync`] = Math.floor(Date.now() / 1000);
          }
        } catch (e) {
          results.errors.push(`${p.name}: ${e.message}`);
          results.perPlatform[platform] = { status: "error", count: 0 };
        }
        continue;
      }

      if (!p.apiSubmissions) {
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

        // ── FAILED QUEUE: Process failed submissions first ──────────────────
        const failedQueueKey = `${platform}FailedQueue`;
        let failedQueue = state[failedQueueKey] || [];

        // ── RESUME INDEX: For mid-sync interruption recovery ─────────────────
        const resumeIndexKey = `${platform}ResumeIndex`;
        let resumeIndex = state[resumeIndexKey] || 0;

        // Merge failed queue items with new subs (failed first)
        let allSubsToScrape = [];
        if (failedQueue.length > 0) {
          mainWindow.webContents.send("status", `[${p.name}] Processing ${failedQueue.length} failed submissions from queue...`);
          allSubsToScrape = [...failedQueue, ...newSubs];
        } else {
          allSubsToScrape = newSubs;
        }

        mainWindow.webContents.send("status", `[${p.name}] Found ${newSubs.length} new AC submissions. Starting code fetch (up to ${targetCount})...`);

        const BATCH_SIZE = 20;
        const BATCH_PAUSE_MS = 120000; // 2 minutes
        let totalScraped = 0;
        let maxTimestamp = lastSync;
        let batchSolutions = [];
        const newFailedQueue = [];

        for (let i = resumeIndex; i < allSubsToScrape.length; i++) {
          const sub = allSubsToScrape[i];
          const isFailedRetry = i < failedQueue.length;
          const progress = `[${p.name}] Scraping ${i + 1}/${allSubsToScrape.length}: ${p.problemName(sub)}${isFailedRetry ? ' (retry)' : ''}`;
          mainWindow.webContents.send("status", progress);

          // Batch pause: after every 20 items, wait 2 minutes
          if (i > resumeIndex && (i - resumeIndex) % BATCH_SIZE === 0) {
            // Upload current batch before pausing
            if (batchSolutions.length > 0) {
              mainWindow.webContents.send("status", `[${p.name}] Uploading batch of ${batchSolutions.length} solutions...`);
              try {
                const res = await fetch(`${codeonUrl}/api/settings/seed-code`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "Authorization": `Bearer ${authToken}` },
                  body: JSON.stringify({ solutions: batchSolutions }),
                });
                if (res.status === 401) {
                  const settings = loadSettings();
                  settings.companionToken = "";
                  saveSettings(settings);
                  mainWindow.webContents.send("status", "ERROR: Companion token is invalid. Generate a new one in web app Settings. Sync aborted.");
                  results.errors.push("Companion token invalid — sync aborted.");
                  results.status = "error";
                  return results;
                }
                const data = await res.json();
                if (data.success) {
                  results.total += batchSolutions.length;
                  mainWindow.webContents.send("status", `[${p.name}] Batch uploaded ✓ (${batchSolutions.length} solutions)`);
                }
              } catch (e) {
                results.errors.push(`${p.name} batch upload failed: ${e.message}`);
              }
              batchSolutions = [];
            }

            // Save progress so we can resume if app is killed
            state[resumeIndexKey] = i;
            state[failedQueueKey] = newFailedQueue;
            saveState(state);

            mainWindow.webContents.send("status", `[${p.name}] Batch pause — waiting 2 minutes to avoid Cloudflare ban...`);
            await new Promise(r => setTimeout(r, BATCH_PAUSE_MS));
          }

          try {
            const code = await Promise.race([
              p.getCode(page, sub),
              new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000)),
            ]);
            if (code && code.trim().length > 20) {
              batchSolutions.push({
                code: code.trim(),
                problemTitle: p.problemName(sub),
                platform,
                tags: p.tags(sub),
                url: platform === 'codeforces'
                  ? (sub.problem.contestId >= 100000
                    ? `https://codeforces.com/gym/${sub.problem.contestId}/problem/${sub.problem.index}`
                    : `https://codeforces.com/problemset/problem/${sub.problem.contestId}/${sub.problem.index}`)
                  : undefined,
              });
              totalScraped++;
              // Track max timestamp for lastSync advancement
              const ts = p.timestamp(sub);
              if (ts > maxTimestamp) maxTimestamp = ts;
              mainWindow.webContents.send("status", `[${p.name}] Scraped ${i + 1}/${allSubsToScrape.length} ✓`);
            } else {
              mainWindow.webContents.send("status", `[${p.name}] Skipped ${i + 1}/${allSubsToScrape.length} (no code — added to failed queue)`);
              newFailedQueue.push({ ...sub, _retryCount: (sub._retryCount || 0) + 1 });
            }
            // Randomized jitter: 3-7 seconds between page loads
            const jitter = 3000 + Math.floor(Math.random() * 4000);
            await new Promise(r => setTimeout(r, jitter));
          } catch (e) {
            if (e.message === "timeout") {
              mainWindow.webContents.send("status", `[${p.name}] Skipped ${i + 1}/${allSubsToScrape.length} (timeout — added to failed queue)`);
            } else {
              mainWindow.webContents.send("status", `[${p.name}] Skipped ${i + 1}/${allSubsToScrape.length} (error — added to failed queue)`);
            }
            newFailedQueue.push({ ...sub, _retryCount: (sub._retryCount || 0) + 1 });
          }
        }

        // Upload final batch
        if (batchSolutions.length > 0) {
          mainWindow.webContents.send("status", `[${p.name}] Uploading final batch of ${batchSolutions.length} solutions...`);
          try {
            const res = await fetch(`${codeonUrl}/api/settings/seed-code`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${authToken}` },
              body: JSON.stringify({ solutions: batchSolutions }),
            });
            if (res.status === 401) {
              const settings = loadSettings();
              settings.companionToken = "";
              saveSettings(settings);
              mainWindow.webContents.send("status", "ERROR: Companion token is invalid. Sync aborted.");
              results.errors.push("Companion token invalid.");
              results.status = "error";
              return results;
            }
            const data = await res.json();
            if (data.success) {
              results.total += batchSolutions.length;
              mainWindow.webContents.send("status", `[${p.name}] Final batch uploaded ✓ (${batchSolutions.length} solutions)`);
            }
          } catch (e) {
            results.errors.push(`${p.name} final batch upload failed: ${e.message}`);
          }
        }

        results.perPlatform[platform] = { status: "done", count: totalScraped };

        // Remove items that failed 3+ times (permanently failed)
        const permanentFailures = newFailedQueue.filter(f => (f._retryCount || 0) >= 3);
        const retriableFailures = newFailedQueue.filter(f => (f._retryCount || 0) < 3);
        if (permanentFailures.length > 0) {
          mainWindow.webContents.send("status", `[${p.name}] ${permanentFailures.length} submissions permanently failed (3+ retries) — removed from queue.`);
        }

        // Advance lastSyncTimestamp to max successful timestamp (decoupled from failed queue)
        if (totalScraped > 0 && maxTimestamp > lastSync) {
          state[`${platform}LastSync`] = maxTimestamp;
        }
        state[failedQueueKey] = retriableFailures;
        state[resumeIndexKey] = 0; // Reset resume index for next sync
        saveState(state);
      } catch (e) {
        results.errors.push(`${p.name}: ${e.message}`);
        results.perPlatform[platform] = { status: "error", count: 0 };
      }
    }

    // Clean up the page we created
    try { await page.close(); } catch {}

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
