const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("fs");
const { homedir } = require("os");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 680,
    resizable: false,
    frame: true,
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

app.on("window-all-closed", () => {
  app.quit();
});

// ── Settings storage ──────────────────────────────────────────────────────
const SETTINGS_FILE = path.join(homedir(), ".codeon", "companion-settings.json");
const PROFILE_DIR = path.join(homedir(), ".codeon", "browser-profile");
const STATE_FILE = path.join(homedir(), ".codeon", "sync-state.json");

function loadSettings() {
  try {
    if (existsSync(SETTINGS_FILE)) return JSON.parse(readFileSync(SETTINGS_FILE, "utf-8"));
  } catch {}
  return { cfHandle: "", lcHandle: "", codeonUrl: "http://localhost:3000" };
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
  return { cfLastSync: 0, lcLastSync: 0 };
}

function saveState(state) {
  const dir = path.dirname(STATE_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ── IPC handlers ──────────────────────────────────────────────────────────

ipcMain.handle("get-settings", () => loadSettings());
ipcMain.handle("save-settings", (_, settings) => saveSettings(settings));

let browserContext = null;

ipcMain.handle("login", async (_, { platform }) => {
  try {
    const { chromium } = require("playwright");
    if (!existsSync(PROFILE_DIR)) mkdirSync(PROFILE_DIR, { recursive: true });

    if (!browserContext) {
      browserContext = await chromium.launchPersistentContext(PROFILE_DIR, {
        headless: false,
        channel: "chrome",
        viewport: null,
        args: ["--start-maximized", "--disable-blink-features=AutomationControlled"],
        ignoreDefaultArgs: ["--enable-automation"],
      });
    }

    const page = await browserContext.newPage();
    const url = platform === "codeforces" ? "https://codeforces.com/enter" : "https://leetcode.com/accounts/login/";
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});

    mainWindow.webContents.send("status", `Chrome opened. Please log into ${platform === "codeforces" ? "Codeforces" : "LeetCode"}, then close the browser.`);

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("sync", async (_, { cfHandle, lcHandle, codeonUrl }) => {
  const state = loadState();
  const results = { cf: 0, lc: 0, total: 0, errors: [] };

  try {
    const { chromium } = require("playwright");

    if (!browserContext) {
      if (!existsSync(PROFILE_DIR)) mkdirSync(PROFILE_DIR, { recursive: true });
      browserContext = await chromium.launchPersistentContext(PROFILE_DIR, {
        headless: false,
        channel: "chrome",
        viewport: null,
        args: ["--start-maximized", "--disable-blink-features=AutomationControlled"],
        ignoreDefaultArgs: ["--enable-automation"],
      });
    }

    // ── Codeforces sync ──────────────────────────────────────────────────
    if (cfHandle) {
      mainWindow.webContents.send("status", "Fetching Codeforces submissions...");

      const page = await browserContext.newPage();
      await page.goto(`https://codeforces.com/api/user.status?handle=${cfHandle}&from=1&count=100`, {
        waitUntil: "domcontentloaded", timeout: 15000,
      }).catch(() => {});

      const apiText = await page.locator("pre").textContent().catch(() => "{}");
      let apiData;
      try { apiData = JSON.parse(apiText); } catch { apiData = { status: "FAIL" }; }

      if (apiData.status === "OK") {
        const newSubs = apiData.result
          .filter(s => s.verdict === "OK" && s.programmingLanguage && s.programmingLanguage.includes("C++") && s.creationTimeSeconds > state.cfLastSync)
          .slice(0, 10);

        mainWindow.webContents.send("status", `Found ${newSubs.length} new CF submissions. Fetching code...`);

        const solutions = [];
        for (const sub of newSubs) {
          const url = `https://codeforces.com/contest/${sub.problem.contestId}/submission/${sub.id}`;
          mainWindow.webContents.send("status", `Fetching: ${sub.problem.name}`);

          try {
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
            for (let i = 0; i < 10; i++) {
              const title = await page.title();
              if (!title.includes("Just a moment")) break;
              await page.waitForTimeout(2000);
            }

            const code = await page.locator("#program-source-text").textContent({ timeout: 5000 }).catch(() => null);
            if (code && code.trim().length > 20) {
              solutions.push({
                code: code.trim(),
                problemTitle: sub.problem.name,
                platform: "codeforces",
                tags: sub.problem.tags || [],
              });
            }
            await page.waitForTimeout(1000);
          } catch (e) {
            results.errors.push(`CF ${sub.problem.name}: ${e.message}`);
          }
        }

        if (solutions.length > 0) {
          mainWindow.webContents.send("status", `Uploading ${solutions.length} CF solutions to CodeOn...`);
          try {
            const res = await fetch(`${codeonUrl}/api/settings/seed-code`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ solutions }),
            });
            const data = await res.json();
            if (data.success) {
              results.cf = solutions.length;
              results.total += solutions.length;
              mainWindow.webContents.send("status", `Uploaded ${solutions.length} CF solutions.`);
            }
          } catch (e) {
            results.errors.push(`Upload failed: ${e.message}. Is CodeOn running at ${codeonUrl}?`);
          }
        }
        state.cfLastSync = Math.floor(Date.now() / 1000);
      }

      await page.close();
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

ipcMain.handle("check-connection", async (_, { codeonUrl }) => {
  try {
    const res = await fetch(`${codeonUrl}/api/settings`, { signal: AbortSignal.timeout(5000) });
    return { connected: res.ok };
  } catch {
    return { connected: false };
  }
});

app.on("before-quit", () => {
  if (browserContext) browserContext.close();
});
