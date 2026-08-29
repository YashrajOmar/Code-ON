const fs = require('fs');

async function test() {
  const url = 'https://codeforces.com/problemset/problem/2000/D';
  const res = await fetch(url, { headers: { 'User-Agent': 'codeOn/1.0 (AI Coding Coach)' } });
  const html = await res.text();
  fs.writeFileSync('cf_problem_test.html', html);
  console.log("Written length:", html.length);
}
test();
