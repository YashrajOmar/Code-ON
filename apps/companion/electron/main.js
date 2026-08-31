const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("fs");
const { homedir } = require("os");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 560,
    height: 780,
    resizable: false,
    title: "CodeOn Companion",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());

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
    apiSubmissions: (handle) => `https://codeforces.com/api/user.status?handle=${handle}&from=1&count=100`,
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
  if (!browserContext || !browserContext.browser() || !browserContext.pages) {
    try {
      if (browserContext) await browserContext.close().catch(() => {});
    } catch {}
    browserContext = null;
  }
  
  if (!browserContext) {
    const { chromium } = require("playwright");
    if (!existsSync(PROFILE_DIR)) mkdirSync(PROFILE_DIR, { recursive: true });
    browserContext = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: false,
      channel: "chrome",
      viewport: null,
      args: ["--start-maximized", "--disable-blink-features=AutomationControlled"],
      ignoreDefaultArgs: ["--enable-automation"],
    });

    // If user closes the browser, mark as closed so next call reopens
    browserContext.on("close", () => {
      browserContext = null;
    });
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
        await page.goto(p.apiSubmissions(handle), { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});

        let apiData;
        if (platform === "codeforces") {
          const apiText = await page.locator("pre").textContent().catch(() => "{}");
          apiData = JSON.parse(apiText);
          if (apiData.status !== "OK") throw new Error("API error");
          apiData = apiData.result;
        } else if (platform === "atcoder") {
          const apiText = await page.locator("pre").textContent().catch(() => "[]");
          apiData = JSON.parse(apiText);
        } else {
          throw new Error("Not implemented");
        }

        const lastSync = state[`${platform}LastSync`] || 0;
        const newSubs = apiData
          .filter(s => p.isAc(s) && p.isCpp(s) && p.timestamp(s) > lastSync)
          .slice(0, 10);

        mainWindow.webContents.send("status", `Found ${newSubs.length} new ${p.name} submissions.`);

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
            const res = await fetch(`${codeonUrl}/api/settings/seed-code`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
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
