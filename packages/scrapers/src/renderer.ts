import type { Browser, BrowserContext } from 'playwright';
import dns from 'dns/promises';
import { ScraperError } from './types';

// RFC 1918 + loopback + link-local
const isPrivateIP = (ip: string) => {
  // IPv4
  if (ip.startsWith('127.')) return true; // Loopback
  if (ip.startsWith('10.')) return true; // 10.0.0.0/8
  if (ip.startsWith('192.168.')) return true; // 192.168.0.0/16
  if (ip.startsWith('169.254.')) return true; // Link-local
  if (ip.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)) return true; // 172.16.0.0/12

  // IPv6
  if (ip === '::1') return true; // Loopback
  if (ip.startsWith('fe80:')) return true; // Link-local
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true; // Unique local (fc00::/7)

  return false;
};

let browserPromise: Promise<Browser> | null = null;

async function getBrowser() {
  if (!browserPromise) {
    const { chromium } = await import('playwright');
    browserPromise = chromium.launch({
      headless: true,
      args: [
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
      ]
    });
  }
  return browserPromise;
}

export async function renderPage(url: string): Promise<string> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  
  let ssrfError = false;

  // TOCTOU SSRF intercept
  await page.route('**/*', async (route) => {
    const request = route.request();
    const reqUrl = new URL(request.url());
    
    try {
      const lookup = await dns.lookup(reqUrl.hostname);
      if (isPrivateIP(lookup.address)) {
        console.error(`[SSRF Blocked] Tried to resolve ${reqUrl.hostname} which resolved to ${lookup.address}`);
        ssrfError = true;
        await route.abort('accessdenied');
        return;
      }
      
      // Pass-through after safe DNS resolution check
      await route.continue();
    } catch (e) {
      // DNS lookup failed, abort
      await route.abort('name_not_resolved');
    }
  });

  try {
    // 5-second hard ceiling for navigation
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 5000 });
  } catch (e: any) {
    if (ssrfError) {
      throw { type: 'SSRFBlockedError', message: 'Navigation blocked due to SSRF policy' } as ScraperError;
    }
    // Timeout is fine if we can still scrape
    if (!e.message.includes('Timeout')) {
      throw { type: 'TimeoutError', message: e.message, stage: 'navigation' } as ScraperError;
    }
  }

  if (ssrfError) {
    await context.close();
    throw { type: 'SSRFBlockedError', message: 'Page resources blocked due to SSRF policy' } as ScraperError;
  }

  // SPA visibility & text-stabilization checks (2 consecutive polls across 600ms)
  let stableText = '';
  try {
    // Wait for common judge content containers before grabbing HTML
    const contentSelectors = [
      ".problem-statement",               // Codeforces
      "[data-track-load='description_content']", // LeetCode
      ".content",                         // AtCoder / Generic
      "article"
    ].join(", ");

    await page.waitForSelector(contentSelectors, { state: 'attached', timeout: 8000 }).catch(() => {
      console.warn("[Playwright] Content container wait timed out; proceeding with available DOM.");
    });
    
    let lastLength = -1;
    let stableCount = 0;
    const maxPolls = 10;
    
    for (let i = 0; i < maxPolls; i++) {
      const currentText = await page.evaluate(() => document.body.innerText);
      if (currentText.length > 50 && currentText.length === lastLength) {
        stableCount++;
        if (stableCount >= 2) {
          stableText = currentText;
          break; // Stabilized
        }
      } else {
        stableCount = 0;
      }
      lastLength = currentText.length;
      await new Promise(r => setTimeout(r, 300));
    }
  } catch (e) {
    // Ignore, just extract what we have
  }

  const finalHtml = await page.content();
  await context.close();

  // Return HTML for LLM extraction
  return finalHtml;
}
