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
    }, 60000); // 60 seconds after startup (was 10s for testing)
}

// ── Storage ────────────────────────────────────────────────────────────────
const SETTINGS_FILE = path.join(homedir(), ".codeon", "companion-settings.json");
const PROFILE_DIR = path.join(homedir(), ".codeon", "browser-profile");
const STATE_FILE = path.join(homedir(), ".codeon", "sync-state.json");

function loadSettings() {
  try {
    if (existsSync(SETTINGS_FILE)) return JSON.parse(readFileSync(SETTINGS_FILE, "utf-8"));
  } catch {}
  return { handles: {}, codeonUrl: "https://codeon-coding-coach-eight.vercel.app" };
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
      await page.waitForTimeout(2000);

      // Step 1: Get ALL solved problems via userProfileQuestions (paginated)
      sendStatus(`[LeetCode] Fetching ALL solved problems...`);

      const allSolved = [];
      let skip = 0;
      const pageSize = 50;

      while (true) {
        sendStatus(`[LeetCode] Fetching solved problems page ${Math.floor(skip / pageSize) + 1}...`);

        const response = await page.request.post("https://leetcode.com/graphql", {
          data: {
            query: `
              query userProfileQuestions($status: StatusFilterEnum!, $skip: Int!, $first: Int!, $sortField: SortFieldEnum!, $sortOrder: SortingOrderEnum!, $keyword: String) {
                userProfileQuestions(status: $status, skip: $skip, first: $first, sortField: $sortField, sortOrder: $sortOrder, keyword: $keyword) {
                  totalNum
                  questions { title titleSlug difficulty topicTags { name } }
                }
              }
            `,
            variables: { status: "ACCEPTED", skip, first: pageSize, sortField: "LAST_SUBMITTED", sortOrder: "DESCENDING", keyword: "" },
          },
        }).catch(() => null);

        if (!response || !response.ok()) {
          sendStatus(`[LeetCode] API request failed. Try logging in again.`);
          return [];
        }

        const data = await response.json();
        const result = data?.data?.userProfileQuestions;

        if (!result || !result.questions || result.questions.length === 0) {
          if (allSolved.length === 0) {
            sendStatus(`[LeetCode] userProfileQuestions returned 0. Trying recentSubmissionList...`);
            const fallbackRes = await page.request.post("https://leetcode.com/graphql", {
              data: {
                query: `query recentSubmissionList($username: String!, $limit: Int) { recentSubmissionList(username: $username, limit: $limit) { id title titleSlug timestamp lang statusDisplay } }`,
                variables: { username: handle, limit: 100 },
              },
            }).catch(() => null);

            if (fallbackRes && fallbackRes.ok()) {
              const fallbackData = await fallbackRes.json();
              const subs = fallbackData?.data?.recentSubmissionList || [];
              for (const sub of subs) {
                if (sub.statusDisplay === "Accepted") {
                  allSolved.push({ title: sub.title, titleSlug: sub.titleSlug, tags: [], submissionId: sub.id });
                }
              }
            }
          }
          break;
        }

        for (const q of result.questions) {
          allSolved.push({ title: q.title, titleSlug: q.titleSlug, tags: (q.topicTags || []).map(t => t.name) });
        }

        sendStatus(`[LeetCode] Found ${allSolved.length} solved problems so far...`);
        if (result.questions.length < pageSize) break;
        skip += pageSize;
        await page.waitForTimeout(500);
      }

      sendStatus(`[LeetCode] Total: ${allSolved.length} solved problems. Now fetching code...`);

      if (allSolved.length === 0) {
        sendStatus(`[LeetCode] No solved problems found. Try logging in again.`);
        return [];
      }

      // Step 2: For each solved problem, get the latest AC submission ID + code
      const limit = Math.min(allSolved.length, targetCount);

      for (let i = 0; i < limit; i++) {
        const prob = allSolved[i];
        const slug = prob.titleSlug;
        sendStatus(`[LeetCode] Scraping ${i + 1}/${limit}: ${prob.title}`);

        try {
          let subId = prob.submissionId || null;

          // If no submissionId, get it from submissionList API
          if (!subId) {
            const subListRes = await page.request.post("https://leetcode.com/graphql", {
              data: {
                query: `query submissionList($questionSlug: String!, $offset: Int, $limit: Int, $status: SubmissionStatusEnum) { submissionList(questionSlug: $questionSlug, offset: $offset, limit: $limit, status: $status) { submissions { id statusDisplay lang } } }`,
                variables: { questionSlug: slug, offset: 0, limit: 1, status: "AC" },
              },
            }).catch(() => null);

            if (subListRes && subListRes.ok()) {
              const subListData = await subListRes.json();
              const submissions = subListData?.data?.submissionList?.submissions || [];
              if (submissions.length > 0) subId = submissions[0].id;
            }
          }

          if (!subId) {
            sendStatus(`[LeetCode] Skipped ${i + 1}/${limit} (no submission ID)`);
            await page.waitForTimeout(500);
            continue;
          }

          // Get the actual code via submissionDetail
          const detailRes = await page.request.post("https://leetcode.com/graphql", {
            data: {
              query: `query submissionDetail($id: ID!) { submissionDetail(submissionId: $id) { code lang statusDisplay } }`,
              variables: { id: String(subId) },
            },
          }).catch(() => null);

          if (detailRes && detailRes.ok()) {
            const detailData = await detailRes.json();
            const detail = detailData?.data?.submissionDetail;

            if (detail && detail.code && detail.code.trim().length > 20) {
              solutions.push({ code: detail.code.trim(), problemTitle: prob.title, platform: "leetcode", tags: prob.tags || [] });
              sendStatus(`[LeetCode] Scraped ${i + 1}/${limit}: ${prob.title} ✓`);
            } else {
              sendStatus(`[LeetCode] Skipped ${i + 1}/${limit} (no code in response)`);
            }
          } else {
            // Fallback: visit the submission page directly and scrape code from DOM
            sendStatus(`[LeetCode] Trying page scrape for ${prob.title}...`);
            await page.goto(`https://leetcode.com/problems/${slug}/submissions/`, { waitUntil: "networkidle", timeout: 15000 }).catch(() => {});
            await page.waitForTimeout(3000);

            const subLink = await page.evaluate(() => {
              const links = Array.from(document.querySelectorAll('a'));
              for (const link of links) {
                const href = link.getAttribute('href') || '';
                if (href.match(/\/submissions\/\d+/)) return href.startsWith('http') ? href : `https://leetcode.com${href}`;
              }
              return null;
            }).catch(() => null);

            if (subLink) {
              await page.goto(subLink, { waitUntil: "networkidle", timeout: 15000 }).catch(() => {});
              await page.waitForTimeout(2000);

              let code = await page.locator("pre code, .monaco-editor .view-line, pre").first().textContent({ timeout: 5000 }).catch(() => null);
              if (code && code.trim().length > 20) {
                solutions.push({ code: code.trim(), problemTitle: prob.title, platform: "leetcode", tags: prob.tags || [] });
                sendStatus(`[LeetCode] Scraped ${i + 1}/${limit}: ${prob.title} ✓ (page scrape)`);
              } else {
                sendStatus(`[LeetCode] Skipped ${i + 1}/${limit} (no code on page)`);
              }
            } else {
              sendStatus(`[LeetCode] Skipped ${i + 1}/${limit} (no submission link)`);
            }
          }

          await page.waitForTimeout(500);
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
  
  // Only kill Chrome processes using OUR profile directory — don't kill user's personal Chrome
  try {
    // Find Chrome PIDs that use our profile directory
    const output = execSync('wmic process where "name=\'chrome.exe\'" get processid,commandline', { encoding: 'utf-8' });
    const lines = output.split('\n');
    for (const line of lines) {
      if (line.includes('.codeon') && line.includes('browser-profile')) {
        const match = line.match(/(\d+)\s*$/);
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

async function getBrowser(visible = false) {
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
  
  const args = ["--disable-blink-features=AutomationControlled"];
  if (visible) {
    // Login mode — visible to user
    args.push("--start-maximized");
  } else {
    // Sync mode — off-screen, but real headed browser (Cloudflare passes)
    args.push("--window-position=-32000,-32000", "--window-size=1280,800");
  }
  
  try {
    browserContext = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: false,
      channel: "chrome",
      viewport: visible ? null : { width: 1280, height: 800 },
      args,
      ignoreDefaultArgs: ["--enable-automation"],
    });
  } catch (e) {
    await killChromeAndClearLocks();
    browserContext = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: false,
      channel: "chrome",
      viewport: visible ? null : { width: 1280, height: 800 },
      args,
      ignoreDefaultArgs: ["--enable-automation"],
    });
  }
  
  return browserContext;
}

ipcMain.handle("login", async (_, { platform }) => {
  try {
    const p = PLATFORMS[platform];
    if (!p) return { success: false, error: "Unknown platform" };

    // For login: close any off-screen browser, launch visible one
    if (browserContext) {
      try { await browserContext.close(); } catch {}
      browserContext = null;
    }

    const browser = await getBrowser(true); // visible for login
    const page = await browser.newPage();
    await page.goto(p.loginUrl, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});

    mainWindow.webContents.send("status", `[${p.name}] Chrome opened (visible). Log in, then close the tab.`);
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
    const browser = await getBrowser(true); // visible Chrome for sync — don't close it during sync
    const page = await browser.newPage();

    for (const [platform, handle] of Object.entries(handles)) {
      if (!handle || !handle.trim()) continue;
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
              const webhookSecret = "codeon-companion-secret";
              const res = await fetch(`${codeonUrl}/api/settings/seed-code`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${webhookSecret}`,
                },
                body: JSON.stringify({ solutions }),
              });
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
        mainWindow.webContents.send("status", `[${p.name}] Found ${newSubs.length} AC submissions across ${pagesFetched} page(s). Starting code fetch (up to ${targetCount})...`);

        const solutions = [];
        for (let i = 0; i < newSubs.length; i++) {
          const sub = newSubs[i];
          const progress = `[${p.name}] Scraping ${i + 1}/${newSubs.length}: ${p.problemName(sub)}`;
          mainWindow.webContents.send("status", progress);
          try {
            const code = await Promise.race([
              p.getCode(page, sub),
              new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000)),
            ]);
            if (code && code.trim().length > 20) {
              solutions.push({
                code: code.trim(),
                problemTitle: p.problemName(sub),
                platform,
                tags: p.tags(sub),
              });
              mainWindow.webContents.send("status", `[${p.name}] Scraped ${i + 1}/${newSubs.length} ✓`);
            } else {
              mainWindow.webContents.send("status", `[${p.name}] Skipped ${i + 1}/${newSubs.length} (no code)`);
            }
            await new Promise(r => setTimeout(r, 1000));
          } catch (e) {
            if (e.message === "timeout") {
              mainWindow.webContents.send("status", `[${p.name}] Skipped ${i + 1}/${newSubs.length} (timeout)`);
              results.errors.push(`${p.name} ${p.problemName(sub)}: page timeout, skipped`);
            } else {
              results.errors.push(`${p.name} ${p.problemName(sub)}: ${e.message}`);
            }
          }
        }

        if (solutions.length > 0) {
          mainWindow.webContents.send("status", `Uploading ${solutions.length} ${p.name} solutions...`);
          try {
            const webhookSecret = "codeon-companion-secret";
            mainWindow.webContents.send("status", `Uploading to ${codeonUrl}/api/settings/seed-code...`);
            const res = await fetch(`${codeonUrl}/api/settings/seed-code`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${webhookSecret}`,
              },
              body: JSON.stringify({ solutions }),
            });
            const resText = await res.text();
            let data;
            try { data = JSON.parse(resText); } catch {
              mainWindow.webContents.send("status", `[${p.name}] Upload failed: server returned HTML (not JSON). Is CodeOn running?`);
              results.errors.push(`${p.name} upload failed: server returned non-JSON response`);
              results.perPlatform[platform] = { status: "upload_error", count: 0 };
            }
            if (data && data.success) {
              results.total += solutions.length;
              results.perPlatform[platform] = { status: "done", count: solutions.length };
              mainWindow.webContents.send("status", `[${p.name}] ${solutions.length} solutions uploaded ✓`);
            } else if (data) {
              mainWindow.webContents.send("status", `[${p.name}] Upload failed: ${data.error || "Unknown error"}`);
              results.errors.push(`${p.name} upload failed: ${data.error || "Unknown error"}`);
              results.perPlatform[platform] = { status: "upload_error", count: 0 };
            }
          } catch (e) {
            results.errors.push(`${p.name} upload failed: ${e.message}`);
            results.perPlatform[platform] = { status: "upload_error", count: 0 };
          }
        } else {
          results.perPlatform[platform] = { status: "done", count: 0 };
        }

        // Only update timestamp if we actually found and uploaded solutions
        if (solutions.length > 0) {
          state[`${platform}LastSync`] = Math.floor(Date.now() / 1000);
        }
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
