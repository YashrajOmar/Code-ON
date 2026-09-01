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

  // allQuestionsRaw WITHOUT topicTags
  console.log('=== Test: allQuestionsRaw (no topicTags) ===');
  const result = await page.evaluate(async () => {
    try {
      const res = await fetch("https://leetcode.com/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: 'query allQuestionsRaw { allQuestionsRaw { title titleSlug difficulty status } }',
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

  // Now test submissionList for first solved problem
  if (result.solvedCount > 0 && result.firstSolved) {
    const firstSlug = 'two-sum'; // we know this works
    console.log('=== Test: submissionList for two-sum ===');
    const result2 = await page.evaluate(async () => {
      try {
        const res = await fetch("https://leetcode.com/graphql", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: 'query submissionList($questionSlug: String!, $offset: Int, $limit: Int) { submissionList(questionSlug: $questionSlug, offset: $offset, limit: $limit) { submissions { id statusDisplay lang } } }',
            variables: { questionSlug: 'two-sum', offset: 0, limit: 5 },
          }),
        });
        const data = await res.json();
        if (data?.errors) return { error: data.errors[0]?.message };
        const subs = data?.data?.submissionList?.submissions || [];
        const ac = subs.filter(s => s.statusDisplay === 'Accepted');
        return { total: subs.length, acCount: ac.length, firstAcId: ac[0]?.id };
      } catch (e) {
        return { error: e.message };
      }
    });
    console.log('submissionList:', JSON.stringify(result2));

    // Test submissionDetails with the AC ID
    if (result2.firstAcId) {
      console.log('=== Test: submissionDetails ===');
      const result3 = await page.evaluate(async (subId) => {
        try {
          const res = await fetch("https://leetcode.com/graphql", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: 'query submissionDetails($submissionId: Int!) { submissionDetails(submissionId: $submissionId) { code lang { name } statusCode statusDisplay } }',
              variables: { submissionId: parseInt(subId) },
            }),
          });
          const data = await res.json();
          if (data?.errors) return { error: data.errors[0]?.message };
          const detail = data?.data?.submissionDetails;
          return { hasCode: !!detail?.code, codeLength: detail?.code?.length, lang: detail?.lang?.name, status: detail?.statusDisplay };
        } catch (e) {
          return { error: e.message };
        }
      }, result2.firstAcId);
      console.log('submissionDetails:', JSON.stringify(result3));
    }
  }

  await browser.close();
  process.exit(0);
})();
