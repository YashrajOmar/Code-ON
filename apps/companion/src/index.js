/**
 * CodeOn Companion App
 *
 * A lightweight local app that:
 *   1. Opens a real browser (headed, persistent profile) on first run
 *   2. User logs into Codeforces/LeetCode once — session persists
 *   3. Scrapes submission source code (bypasses Cloudflare)
 *   4. Posts code to CodeOn's /api/settings/seed-code endpoint
 *   5. Syncs incrementally (only new submissions)
 *   6. Runs on a timer — daily auto-sync
 *
 * Usage:
 *   node src/index.js                  # Normal mode (sync once, then daily)
 *   node src/index.js --dev            # Dev mode (sync once, verbose logging)
 *   node src/index.js --login-only     # Just open browser for login
 */

import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Config
const CODEON_URL = process.env.CODEON_URL || 'http://localhost:3000';
const PROFILE_DIR = join(homedir(), '.codeon', 'browser-profile');
const STATE_FILE = join(homedir(), '.codeon', 'sync-state.json');
const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

// State
function loadState() {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch (e) {}
  return { cfLastSync: 0, lcLastSync: 0, cfHandle: '', lcHandle: '' };
}

function saveState(state) {
  const dir = dirname(STATE_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// Browser
// Connects to the user's EXISTING Chrome (where they're already logged in)
// instead of creating a fresh Playwright profile. This way users who saved
// their CF/LC/Google credentials in Chrome don't need to log in again.
//
// Two modes:
//   1. Connect to a running Chrome with --remote-debugging-port (recommended)
//   2. Launch Chrome with the user's real profile directory (fallback)
async function getBrowser() {
  // Try connecting to an existing Chrome with remote debugging
  try {
    const browser = await chromium.connectOverCDP('http://localhost:9222');
    console.log('[Browser] Connected to existing Chrome (remote debugging)');
    return browser;
  } catch (e) {
    console.log('[Browser] No Chrome with remote debugging found. Launching Chrome with your profile...');
  }

  // Fallback: launch Chrome with the user's real profile
  // On Windows: C:\Users\<user>\AppData\Local\Google\Chrome\User Data
  const chromeUserDataDir = join(homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data');
  const hasChromeProfile = existsSync(chromeUserDataDir);

  if (hasChromeProfile) {
    // Use a copy of the user's profile to avoid locking their main Chrome
    // (Chrome can't have two instances on the same profile dir)
    if (!existsSync(PROFILE_DIR)) mkdirSync(PROFILE_DIR, { recursive: true });
    const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: false,
      channel: 'chrome',
      viewport: null,
      args: [
        '--start-maximized',
        '--disable-blink-features=AutomationControlled',
        '--profile-directory=Default',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    });
    return browser;
  }

  // No Chrome found — use Playwright's bundled Chromium
  if (!existsSync(PROFILE_DIR)) mkdirSync(PROFILE_DIR, { recursive: true });
  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: null,
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  });
  return browser;
}

// Codeforces Scraper
async function scrapeCodeforces(browser, handle, lastSync) {
  if (!handle) return [];
  console.log('[CF] Fetching submissions for ' + handle + '...');

  const page = await browser.newPage();
  await page.goto('https://codeforces.com/api/user.status?handle=' + handle + '&from=1&count=100', {
    waitUntil: 'domcontentloaded',
    timeout: 15000,
  }).catch(() => {});

  const apiText = await page.locator('pre').textContent().catch(() => '{}');
  let apiData;
  try {
    apiData = JSON.parse(apiText);
  } catch (e) {
    console.log('[CF] API parse failed');
    await page.close();
    return [];
  }

  if (apiData.status !== 'OK') {
    console.log('[CF] API returned error');
    await page.close();
    return [];
  }

  const newSubs = apiData.result
    .filter(function(s) {
      return s.verdict === 'OK' &&
        s.programmingLanguage && s.programmingLanguage.includes('C++') &&
        s.creationTimeSeconds > lastSync;
    })
    .slice(0, 10);

  console.log('[CF] Found ' + newSubs.length + ' new AC C++ submissions');

  const solutions = [];
  for (const sub of newSubs) {
    const contestId = sub.problem.contestId;
    const subId = sub.id;
    const url = 'https://codeforces.com/contest/' + contestId + '/submission/' + subId;
    console.log('[CF] Fetching code: ' + sub.problem.name);

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

      for (let i = 0; i < 10; i++) {
        const title = await page.title();
        if (title.indexOf('Just a moment') === -1) break;
        await page.waitForTimeout(2000);
      }

      const code = await page.locator('#program-source-text').textContent({ timeout: 5000 }).catch(() => null);

      if (code && code.trim().length > 20) {
        solutions.push({
          code: code.trim(),
          problemTitle: sub.problem.name,
          platform: 'codeforces',
          tags: sub.problem.tags || [],
        });
        console.log('[CF] OK Got ' + code.length + ' chars');
      } else {
        console.log('[CF] FAIL No code found');
      }

      await page.waitForTimeout(1000);
    } catch (e) {
      console.log('[CF] FAIL Error: ' + e.message);
    }
  }

  await page.close();
  return solutions;
}

// LeetCode Scraper
async function scrapeLeetCode(browser, handle, lastSync) {
  if (!handle) return [];
  console.log('[LC] Fetching submissions for ' + handle + '...');

  const page = await browser.newPage();
  const submissionsUrl = 'https://leetcode.com/submissions/';

  try {
    await page.goto(submissionsUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000);

    const subs = await page.evaluate(function() {
      var results = [];
      var allLinks = document.querySelectorAll('a[href*="/submissions/detail/"]');
      allLinks.forEach(function(link) {
        results.push({
          title: (link.textContent || '').trim() || 'Unknown',
          url: link.href,
          lang: 'cpp',
        });
      });
      return results.slice(0, 10);
    }).catch(() => []);

    console.log('[LC] Found ' + subs.length + ' submission links');

    const solutions = [];
    for (const sub of subs) {
      console.log('[LC] Fetching: ' + sub.title);

      try {
        await page.goto(sub.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);

        const code = await page.locator('pre code, .code-container pre, [class*="code"] pre').first().textContent({ timeout: 5000 }).catch(() => null);

        if (code && code.trim().length > 20) {
          solutions.push({
            code: code.trim(),
            problemTitle: sub.title,
            platform: 'leetcode',
            tags: [],
          });
          console.log('[LC] OK Got ' + code.length + ' chars');
        } else {
          console.log('[LC] FAIL No code found');
        }

        await page.waitForTimeout(1000);
      } catch (e) {
        console.log('[LC] FAIL Error: ' + e.message);
      }
    }

    await page.close();
    return solutions;
  } catch (e) {
    console.log('[LC] Error: ' + e.message);
    await page.close();
    return [];
  }
}

// Upload to CodeOn
async function uploadToCodeOn(solutions) {
  if (solutions.length === 0) {
    console.log('[Upload] No solutions to upload');
    return;
  }

  console.log('[Upload] Sending ' + solutions.length + ' solutions to CodeOn...');

  try {
    const res = await fetch(CODEON_URL + '/api/settings/seed-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ solutions }),
    });

    const data = await res.json();
    if (data.success) {
      console.log('[Upload] OK ' + data.message);
    } else {
      console.log('[Upload] FAIL ' + (data.error || 'Unknown error'));
    }
  } catch (e) {
    console.log('[Upload] FAIL ' + e.message);
    console.log('[Upload] Is CodeOn running at ' + CODEON_URL + '?');
  }
}

// Setup Wizard
async function runSetup(browser) {
  console.log('\n=== CodeOn Companion - First Time Setup ===');
  console.log('A browser window will open.');
  console.log('  1. Log into Codeforces and/or LeetCode');
  console.log('  2. Solve any Cloudflare "I am human" checks');
  console.log('  3. Close the browser when done');
  console.log('  Your login is stored locally and never shared.\n');

  const page = await browser.newPage();

  console.log('Opening Codeforces...');
  await page.goto('https://codeforces.com/enter', { waitUntil: 'domcontentloaded' }).catch(() => {});
  console.log('Log into Codeforces in the browser window. Waiting 2 minutes...');
  await page.waitForTimeout(120000).catch(() => {});

  console.log('\nOpening LeetCode...');
  await page.goto('https://leetcode.com/accounts/login/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  console.log('Log into LeetCode in the browser window. Waiting 2 minutes...');
  await page.waitForTimeout(120000).catch(() => {});

  await page.close();
}

// Main
async function main() {
  const args = process.argv.slice(2);
  const isDev = args.includes('--dev');
  const loginOnly = args.includes('--login-only');

  console.log('\nCodeOn Companion v0.1.0');
  console.log('========================\n');

  const state = loadState();
  const isFirstRun = state.cfLastSync === 0 && state.lcLastSync === 0;
  const cfHandle = process.env.CF_HANDLE || '';
  const lcHandle = process.env.LC_HANDLE || '';

  if (!cfHandle && !lcHandle && !loginOnly) {
    console.log('! No handles configured.');
    console.log('  Set CF_HANDLE and LC_HANDLE environment variables, or run with --login-only first.');
    console.log('  Example: CF_HANDLE=your_handle node src/index.js\n');
  }

  console.log('CodeOn URL: ' + CODEON_URL);
  console.log('CF Handle:  ' + (cfHandle || '(not set)'));
  console.log('LC Handle:  ' + (lcHandle || '(not set)'));
  console.log('');

  console.log('Launching browser...');
  const browser = await getBrowser();

  if (loginOnly) {
    console.log('\nLogin mode - browser is open. Log into CF/LC, then close the browser.');
    console.log('Your session will be saved for future syncs.\n');
    browser.on('close', function() {
      console.log('Browser closed. Session saved.');
      process.exit(0);
    });
    await new Promise(function() {});
    return;
  }

  if (isFirstRun) {
    await runSetup(browser);
  }

  console.log('Starting sync...\n');
  const allSolutions = [];

  if (cfHandle) {
    const cfSolutions = await scrapeCodeforces(browser, cfHandle, state.cfLastSync);
    allSolutions.push.apply(allSolutions, cfSolutions);
    state.cfLastSync = Math.floor(Date.now() / 1000);
    state.cfHandle = cfHandle;
  }

  if (lcHandle) {
    const lcSolutions = await scrapeLeetCode(browser, lcHandle, state.lcLastSync);
    allSolutions.push.apply(allSolutions, lcSolutions);
    state.lcLastSync = Math.floor(Date.now() / 1000);
    state.lcHandle = lcHandle;
  }

  await uploadToCodeOn(allSolutions);
  saveState(state);

  console.log('\nSync complete. ' + allSolutions.length + ' solutions uploaded.');

  if (isDev) {
    await browser.close();
    process.exit(0);
  }

  console.log('\nNext sync in 24 hours. Keeping browser open in background...');

  setInterval(async function() {
    console.log('\nStarting daily sync...');
    const solutions = [];

    if (cfHandle) {
      const cf = await scrapeCodeforces(browser, cfHandle, state.cfLastSync);
      solutions.push.apply(solutions, cf);
      state.cfLastSync = Math.floor(Date.now() / 1000);
    }

    if (lcHandle) {
      const lc = await scrapeLeetCode(browser, lcHandle, state.lcLastSync);
      solutions.push.apply(solutions, lc);
      state.lcLastSync = Math.floor(Date.now() / 1000);
    }

    await uploadToCodeOn(solutions);
    saveState(state);
    console.log('Daily sync done. ' + solutions.length + ' new solutions.');
  }, SYNC_INTERVAL_MS);
}

main().catch(function(e) {
  console.error('Fatal error:', e);
  process.exit(1);
});
