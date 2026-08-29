import { NextResponse } from "next/server";
import { renderPage } from "@codeon/scrapers";

/**
 * GET /api/playground?url=<leetcode playground url>
 *
 * Fetches LeetCode playground code using Playwright (real headless Chromium)
 * to bypass Cloudflare bot protection. Then extracts the code from the
 * rendered HTML.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const target = url.searchParams.get("url");

  if (!target) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }

  if (
    parsed.hostname !== "leetcode.com" &&
    parsed.hostname !== "www.leetcode.com"
  ) {
    return NextResponse.json({ error: "Only leetcode.com playgrounds are supported" }, { status: 403 });
  }

  try {
    // Use Playwright to render the page with a real browser.
    // This bypasses LeetCode's Cloudflare bot detection.
    const html = await renderPage(target);

    // Strategy 1: __NEXT_DATA__ JSON blob (LeetCode is a Next.js app)
    const nextDataMatch = html.match(
      /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i
    );
    if (nextDataMatch) {
      try {
        const data = JSON.parse(nextDataMatch[1]);
        const code =
          data?.props?.pageProps?.playground?.code ??
          data?.props?.pageProps?.question?.codeSnippet ??
          data?.props?.pageProps?.code ??
          null;
        if (code && typeof code === "string" && code.trim().length > 5) {
          return NextResponse.json({ code: code.trim(), language: detectLanguage(code) });
        }
      } catch {
        // Fall through
      }
    }

    // Strategy 2: <pre><code> block
    const preMatch = html.match(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/i);
    if (preMatch) {
      const code = decodeEntities(stripTags(preMatch[1]));
      if (code.trim().length > 5) {
        return NextResponse.json({ code: code.trim(), language: detectLanguage(code) });
      }
    }

    // Strategy 3: Any <code> block with multi-line content
    const codeMatches = [...html.matchAll(/<code[^>]*>([\s\S]*?)<\/code>/gi)];
    for (const m of codeMatches) {
      const code = decodeEntities(stripTags(m[1]));
      if (code.trim().length > 20 && /\n/.test(code)) {
        return NextResponse.json({ code: code.trim(), language: detectLanguage(code) });
      }
    }

    // Strategy 4: LeetCode playground may store code in a data attribute or textarea
    const textareaMatch = html.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/i);
    if (textareaMatch) {
      const code = decodeEntities(textareaMatch[1]);
      if (code.trim().length > 10) {
        return NextResponse.json({ code: code.trim(), language: detectLanguage(code) });
      }
    }

    return NextResponse.json(
      { error: "Could not extract code from playground page", fallbackUrl: target },
      { status: 404 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message, fallbackUrl: target }, { status: 502 });
  }
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

function decodeEntities(text: string): string {
  return text
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/'/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&/g, "&");
}

function detectLanguage(code: string): string {
  if (/#include\s*</.test(code) || /\bstd::/.test(code)) return "cpp";
  if (/\bpublic\s+(?:static\s+)?(?:void|class)\b/.test(code)) return "java";
  if (/\bdef\s+\w+\s*\(/.test(code) || /\bprint\s*\(/.test(code)) return "python";
  if (/\bfunc\s+\w+\s*\(/.test(code)) return "go";
  if (/\bfn\s+\w+/.test(code)) return "rust";
  if (/\bconsole\.log\b/.test(code) || /\bconst\s+\w+\s*=/.test(code)) return "javascript";
  return "cpp";
}
