// Debug: see what HTML CF returns
const url = 'https://codeforces.com/contest/2025/submission/388601887';
const res = await fetch(url, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://codeforces.com/profile/Korosuke_12',
  },
});
const html = await res.text();
console.log('Status:', res.status);
console.log('Length:', html.length);
console.log('First 500 chars:', html.substring(0, 500));
console.log('\n--- Has program-source:', html.includes('program-source'));
console.log('--- Has source:', html.includes('source'));
console.log('--- Has pre:', html.includes('<pre'));
console.log('--- Has Please wait:', html.includes('Please wait'));
console.log('--- Has browser:', html.includes('browser'));
