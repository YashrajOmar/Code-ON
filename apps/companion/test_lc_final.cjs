const { chromium } = require('playwright');
const path = require('path');
const { homedir } = require('os');

const PROFILE_DIR = path.join(homedir(), '.codeon', 'browser-profile');

(async () => {
  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false, channel: 'chrome', viewport: null,
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const page = await browser.newPage();
  await page.goto('https://leetcode.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(5000);

  // Check: are we logged in?
  console.log('=== Checking login status ===');
  const url = page.url();
  console.log('Current URL:', url);

  // Check if there's a login/sign-in button
  const loginButton = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      hasSignIn: text.includes('Sign in') || text.includes('Login') || text.includes('Log in'),
      hasSignOut: text.includes('Sign out') || text.includes('Logout'),
    };
  });
  console.log('Login buttons:', JSON.stringify(loginButton));

  // Try allQuestionsRaw
  console.log('=== Test: allQuestionsRaw ===');
  const result = await page.evaluate(async () => {
    try {
      const res = await fetch("https://leetcode.com/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: 'query allQuestionsRaw { allQuestionsRaw { title titleSlug difficulty status topicTags { name } } }',
        }),
      });
      const data = await res.json();
      if (data?.errors) return { error: data.errors[0]?.message };
      const all = data?.data?.allQuestionsRaw || [];
      const solved = all.filter(q => q.status === 'ac');
      return { totalQuestions: all.length, solvedCount: solved.length, firstSolved: solved[0]?.title, firstStatus: solved[0]?.status };
    } catch (e) {
      return { error: e.message };
    }
  });
  console.log('allQuestionsRaw:', JSON.stringify(result));

  await browser.close();
  process.exit(0);
})();
