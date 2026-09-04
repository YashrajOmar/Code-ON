"use client";

import { useState, useEffect } from "react";
import ProblemStatementView from "@/components/ProblemStatementView";
import { useProblemStore } from "@/store/useProblemStore";
import { useIDEStore } from "@/store/useIDEStore";
import type { PublicScrapedProblemDTO } from "@codeon/scrapers";

// Since ScrapedProblem does not currently have tags and difficulty natively,
// we export an extended type so FlexLayoutWrapper and other files don't break immediately.
// We will mock difficulty as 'medium' and tags as empty.
export type ProblemData = PublicScrapedProblemDTO & {
  difficulty?: string;
  tags?: string[];
  source?: string;
};

/** Generates dynamic optimization trail steps based on problem tags & difficulty */
function getOptimizationTrail(tags: string[], difficulty: string) {
  const tagList = tags.map((t) => t.toLowerCase());

  if (tagList.some((t) => t.includes("dp") || t.includes("dynamic"))) {
    return [
      { level: "recursion", label: "Brute Force O(2ⁿ)", desc: "Naive Recursive Tree Search", done: false, current: true },
      { level: "memoization", label: "Top-Down DP O(N)", desc: "Recursion + Hash/Memoization Cache", done: false },
      { level: "tabulation", label: "Optimal Bottom-Up O(N)", desc: "1D/2D Tabulation Space-Optimized", done: false },
    ];
  }

  if (tagList.some((t) => t.includes("binary_search") || t.includes("binary search"))) {
    return [
      { level: "linear", label: "Linear Search O(N)", desc: "Sequential Search over Range", done: false, current: true },
      { level: "binary_search", label: "Binary Search O(log N)", desc: "Binary Search on Monotonic Search Space", done: false },
      { level: "optimal", label: "Optimal O(log N)", desc: "Binary Search with Bitwise Bounds", done: false },
    ];
  }

  if (tagList.some((t) => t.includes("hash") || t.includes("map") || t.includes("array"))) {
    return [
      { level: "brute_force", label: "Brute Force O(N²)", desc: "Nested Loop Search", done: false, current: true },
      { level: "hash_map", label: "Hash Map O(N)", desc: "Hash Map Single-Pass Lookup", done: false },
      { level: "optimal", label: "Optimal O(N)", desc: "In-Place Single-Pass Memory-Optimized", done: false },
    ];
  }

  if (tagList.some((t) => t.includes("sort") || t.includes("two_pointer"))) {
    return [
      { level: "brute_force", label: "Brute Force O(N²)", desc: "Pairwise Search", done: false, current: true },
      { level: "sorting", label: "Sorting O(N log N)", desc: "Sort + Two-Pointer Technique", done: false },
      { level: "optimal", label: "Optimal O(N)", desc: "Radix / Counting Sort or Linear Scan", done: false },
    ];
  }

  // Default dynamic fallback
  return [
    { level: "naive", label: "Naive Approach", desc: "Direct Simulation / Brute Force", done: false, current: true },
    { level: "pattern", label: "Pattern Optimization", desc: "Identify Optimal Data Structure", done: false },
    { level: "optimal", label: `Optimal Solution (${difficulty.toUpperCase()})`, desc: "Scalable Target Complexity", done: false },
  ];
}

interface ProblemPanelProps {
  onProblemLoaded?: (p: ProblemData) => void;
  autoLoadUrl?: string | null;
  onAutoLoadDone?: () => void;
  activeTab?: "statement" | "trail" | "editorial";
  problemData?: ProblemData | null;
}

// Bookmarklet code — stored as a string to avoid JSX parsing issues with </ in selectors
const BOOKMARKLET_CODE = [
  "javascript:(async function(){",
  "const html=document.documentElement.outerHTML;",
  "const url=location.href;",
  "let edHtml=null;",
  "const t=document.querySelector('a[href*=\"/blog/entry/\"]');",
  "if(t){try{const r=await fetch(t.href);edHtml=await r.text();}catch(e){}}",
  "const r=await fetch('https://codeon-coding-coach-eight.vercel.app/api/problem/bookmarklet',",
  "{method:'POST',headers:{'Content-Type':'application/json'},",
  "body:JSON.stringify({url,html,editorialHtml:edHtml})});",
  "const d=await r.json();",
  "if(d.success){alert('Problem sent to CodeOn: '+d.problem.title);}",
  "else{alert('Failed: '+d.error);}",
  "})()"
].join("");

export default function ProblemPanel({ onProblemLoaded, autoLoadUrl, onAutoLoadDone, activeTab: externalTab, problemData: externalProblem }: ProblemPanelProps) {
  const [internalTab, setTab] = useState<"statement" | "trail" | "editorial">("statement");
  const tab = externalTab ?? internalTab;

  const [internalProblem, setInternalProblem] = useState<ProblemData | null>(null);
  const problem = externalProblem !== undefined ? externalProblem : internalProblem;
  const [urlInput, setUrlInput] = useState("");
  const [isScraping, setIsScraping] = useState(false);
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [scrapeProgress, setScrapeProgress] = useState<string | null>(null);
  const [showManualPaste, setShowManualPaste] = useState(false);
  const [manualPasteText, setManualPasteText] = useState("");
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);

  const setScrapedProblem = useProblemStore((state) => state.setScrapedProblem);
  const { code: editorCode } = useIDEStore();

  // Auto-load when parent passes a URL (e.g. clicking recommendation in Dashboard)
  useEffect(() => {
    if (!autoLoadUrl) return;
    setUrlInput(autoLoadUrl);
    scrapeUrl(autoLoadUrl);
    onAutoLoadDone?.();
  }, [autoLoadUrl]);

  function updateProblem(p: PublicScrapedProblemDTO) {
    const pData: ProblemData = {
      ...p,
      difficulty: "medium", // mock default
      tags: [], // mock default
      source: p.platform
    };
    setInternalProblem(pData);
    setScrapedProblem(p as any);
    onProblemLoaded?.(pData);
  }

  // ── Companion app fallback: scrape CF via the companion's real Chrome browser ─
  async function tryCompanionScrape(url: string): Promise<boolean> {
    try {
      setScrapeProgress("Checking for Companion app...");

      // Step 1: Check if companion is running
      const healthRes = await fetch("http://localhost:17890/health", {
        signal: AbortSignal.timeout(3000),
      }).catch(() => null);

      if (!healthRes || !healthRes.ok) {
        return false;
      }

      // Step 2: Scrape problem + editorial via companion (one request)
      setScrapeProgress("Companion: Opening Codeforces in Chrome...");
      const scrapeRes = await fetch("http://localhost:17890/scrape-cf-problem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(60000),
      }).catch(() => null);

      if (!scrapeRes || !scrapeRes.ok) {
        const errData = scrapeRes ? await scrapeRes.json().catch(() => ({})) : {};
        setScrapeError(`Companion scrape failed: ${errData.error || "unknown error"}`);
        return false;
      }

      const { problemHtml, editorialHtml } = await scrapeRes.json();
      if (!problemHtml || !problemHtml.includes("problem-statement")) {
        setScrapeError("Companion returned HTML but no problem statement found");
        return false;
      }

      // Step 3: Parse the HTML via the web app's parse endpoint
      setScrapeProgress("Companion: Parsing problem...");
      const parseRes = await fetch("/api/problem/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, problemHtml, editorialHtml }),
      });

      if (!parseRes.ok) {
        const errData = await parseRes.json().catch(() => ({}));
        setScrapeError(`Parse failed: ${errData.error || "unknown error"}`);
        return false;
      }

      const { problem, tutorialUrl } = await parseRes.json();

      // Step 4: If editorial not yet scraped but tutorialUrl exists, fetch it via companion
      if (problem && tutorialUrl && !problem.content?.editorialMarkdown) {
        setScrapeProgress("Companion: Fetching editorial...");
        try {
          const edRes = await fetch("http://localhost:17890/scrape", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: tutorialUrl }),
            signal: AbortSignal.timeout(30000),
          });
          if (edRes.ok) {
            const { html: edHtml } = await edRes.json();
            if (edHtml) {
              const parseRes2 = await fetch("/api/problem/parse", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url, problemHtml, editorialHtml: edHtml }),
              });
              if (parseRes2.ok) {
                const data2 = await parseRes2.json();
                if (data2.problem) {
                  updateProblem(data2.problem);
                  setUrlInput("");
                  setTab("statement");
                  return true;
                }
              }
            }
          }
        } catch {}
      }

      if (problem) {
        updateProblem(problem);
        setUrlInput("");
        setTab("statement");
        return true;
      }

      setScrapeError("Companion returned data but parsing produced no problem");
      return false;
    } catch {
      return false;
    }
  }

  // ── Manual paste fallback ──────────────────────────────────────────────────
  async function handleManualPaste() {
    if (!manualPasteText.trim() || !blockedUrl) return;
    setIsScraping(true);
    setScrapeError(null);
    setScrapeProgress("Parsing pasted content...");

    try {
      const isHtml = manualPasteText.includes("<") && manualPasteText.includes(">");
      const parseRes = await fetch("/api/problem/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: blockedUrl,
          problemHtml: isHtml ? manualPasteText : undefined,
          rawText: isHtml ? undefined : manualPasteText,
        }),
      });

      if (!parseRes.ok) {
        const errData = await parseRes.json().catch(() => ({}));
        setScrapeError(`Parse failed: ${errData.error || "unknown error"}`);
        return;
      }

      const { problem } = await parseRes.json();
      if (problem) {
        updateProblem(problem);
        setShowManualPaste(false);
        setManualPasteText("");
        setBlockedUrl(null);
        setTab("statement");
      } else {
        setScrapeError("Could not parse the pasted content");
      }
    } catch {
      setScrapeError("Network error while parsing pasted content");
    } finally {
      setIsScraping(false);
      setScrapeProgress(null);
    }
  }

  async function scrapeUrl(url: string) {
    if (!url.trim() || isScraping) return;
    setIsScraping(true);
    setScrapeError(null);
    setScrapeProgress("Initializing scraper...");

    try {
      const res = await fetch("/api/problem/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });

      if (!res.body) {
        throw new Error("No response body");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          if (!part.trim()) continue;

          let eventName = "message";
          let eventData = "";

          const lines = part.split("\n");
          for (const line of lines) {
            if (line.startsWith("event:")) {
              eventName = line.substring(6).trim();
            } else if (line.startsWith("data:")) {
              eventData = line.substring(5).trim();
            }
          }

          if (eventData) {
            try {
              const data = JSON.parse(eventData);
              if (eventName === "progress") {
                setScrapeProgress(data.message);
              } else if (eventName === "success") {
                // Check if statement is actually present (not empty)
                if (data.data?.content?.problemStatementMarkdown && data.data.content.problemStatementMarkdown.length > 20) {
                  updateProblem(data.data);
                  setUrlInput("");
                  setTab("statement");
                } else {
                  // Empty statement = Cloudflare blocked. Show manual paste.
                  setBlockedUrl(url.trim());
                  setScrapeError("Codeforces blocked by Cloudflare. Open the URL in your browser, copy the page source, and paste it below.");
                  setShowManualPaste(true);
                }
              } else if (eventName === "blocked") {
                setBlockedUrl(url.trim());
                setScrapeProgress("Codeforces blocked. Trying Companion app...");
                const companionOk = await tryCompanionScrape(url.trim());
                if (!companionOk) {
                  setScrapeError(data.message || "Codeforces blocked. Use the bookmarklet or paste the problem manually.");
                  setShowManualPaste(true);
                }
              } else if (eventName === "error") {
                if (url.includes('codeforces.com')) {
                  setBlockedUrl(url.trim());
                  setScrapeError(data.message || "Scraping failed. Open the URL in your browser and paste the page source below.");
                  setShowManualPaste(true);
                } else {
                  setScrapeError(data.message || "Failed to scrape problem");
                }
              }
            } catch (e) {
              console.error("Failed to parse SSE data", e);
            }
          }
        }
      }
    } catch {
      setScrapeError("Network error. Could not reach scraper service.");
    } finally {
      setIsScraping(false);
      setScrapeProgress(null);
    }
  }

  function handleImportProblem() {
    scrapeUrl(urlInput);
  }

  return (
    <div style={{
      width: "100%",
      height: "100vh",
      display: "flex",
      flexDirection: "column",
      background: "var(--surface-1)",
      borderRight: "1px solid var(--border-subtle)",
    }}>
      {/* URL Import Bar */}
      <div style={{
        padding: "12px 16px",
        background: "var(--surface-2)",
        borderBottom: "1px solid var(--border-subtle)",
      }}>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          🔗 Import Problem Link
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleImportProblem(); }}
            placeholder="Paste LeetCode or Codeforces URL…"
            style={{
              flex: 1, padding: "6px 10px", borderRadius: 6,
              background: "var(--surface-3)", border: "1px solid var(--border-default)",
              color: "var(--text-primary)", fontSize: 12, outline: "none",
            }}
          />
          <button
            onClick={handleImportProblem}
            disabled={isScraping || !urlInput.trim()}
            style={{
              padding: "6px 12px", borderRadius: 6, border: "none",
              background: "linear-gradient(135deg, var(--brand-violet), var(--brand-indigo))",
              color: "white", fontSize: 12, fontWeight: 600,
              cursor: (isScraping || !urlInput.trim()) ? "not-allowed" : "pointer",
              opacity: (isScraping || !urlInput.trim()) ? 0.6 : 1,
              whiteSpace: "nowrap",
            }}
          >
            {isScraping ? "Scraping…" : "Import"}
          </button>
        </div>
        {isScraping && scrapeProgress && (
          <div style={{ fontSize: 11, color: "var(--brand-violet-light)", marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="spinner" style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid rgba(255,255,255,0.2)', borderTopColor: 'currentColor', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></span>
            {scrapeProgress}
          </div>
        )}
        {scrapeError && (
          <div style={{ fontSize: 11, color: "var(--brand-rose)", marginTop: 6 }}>
            ⚠️ {scrapeError}
          </div>
        )}
        {showManualPaste && (
          <div style={{ marginTop: 10, padding: 14, background: "var(--surface-3)", borderRadius: 8, border: "1px solid var(--border-default)" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 10 }}>
              Codeforces is blocking automated access. Here are two ways to import the problem:
            </div>

            {/* Option 1: Copy Page Source (Simple) */}
            <div style={{ marginBottom: 16, padding: 10, background: "var(--surface-2)", borderRadius: 8, border: "1px solid var(--brand-cyan)" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--brand-cyan)", marginBottom: 8 }}>
                Option 1: Copy Page Source (Easiest)
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.7, marginBottom: 8 }}>
                <strong style={{ color: "var(--text-secondary)" }}>Step 1:</strong> Click the button below to open the problem page in your browser<br/>
                <strong style={{ color: "var(--text-secondary)" }}>Step 2:</strong> On the problem page, press <kbd style={{ background: "var(--surface-1)", padding: "1px 4px", borderRadius: 3, border: "1px solid var(--border-default)" }}>Ctrl+U</kbd> to view the page source<br/>
                <strong style={{ color: "var(--text-secondary)" }}>Step 3:</strong> Press <kbd style={{ background: "var(--surface-1)", padding: "1px 4px", borderRadius: 3, border: "1px solid var(--border-default)" }}>Ctrl+A</kbd> then <kbd style={{ background: "var(--surface-1)", padding: "1px 4px", borderRadius: 3, border: "1px solid var(--border-default)" }}>Ctrl+C</kbd> to copy everything<br/>
                <strong style={{ color: "var(--text-secondary)" }}>Step 4:</strong> Come back here and paste it in the box below<br/>
                <strong style={{ color: "var(--text-secondary)" }}>Step 5:</strong> Click "Parse" — the problem + examples + time limits will appear
              </div>
              <button
                onClick={() => { if (blockedUrl) window.open(blockedUrl, "_blank"); }}
                style={{
                  padding: "6px 14px", borderRadius: 6, border: "1px solid var(--brand-cyan)",
                  background: "rgba(34,211,238,0.1)", color: "var(--brand-cyan)",
                  fontSize: 12, fontWeight: 600, cursor: "pointer",
                }}
              >
                Open Problem in Browser
              </button>
              <textarea
                value={manualPasteText}
                onChange={(e) => setManualPasteText(e.target.value)}
                placeholder="Paste the page source code here (Ctrl+V)..."
                style={{
                  width: "100%", minHeight: 60, marginTop: 8, padding: "6px 8px", borderRadius: 5,
                  background: "var(--surface-1)", border: "1px solid var(--border-default)",
                  color: "var(--text-primary)", fontSize: 11, fontFamily: "monospace",
                  outline: "none", resize: "vertical",
                }}
              />
              <button
                onClick={handleManualPaste}
                disabled={isScraping || !manualPasteText.trim()}
                style={{
                  marginTop: 6, padding: "6px 16px", borderRadius: 5, border: "none",
                  background: "linear-gradient(135deg, var(--brand-violet), var(--brand-indigo))",
                  color: "white", fontSize: 12, fontWeight: 600,
                  cursor: (isScraping || !manualPasteText.trim()) ? "not-allowed" : "pointer",
                  opacity: (isScraping || !manualPasteText.trim()) ? 0.6 : 1,
                }}
              >
                Parse Pasted Content
              </button>
            </div>

            {/* Option 2: Bookmarklet (Advanced) */}
            <details style={{ marginTop: 8 }}>
              <summary style={{ fontSize: 12, fontWeight: 600, color: "var(--brand-violet-light)", cursor: "pointer", padding: "4px 0" }}>
                Option 2: Use a Bookmarklet (One-click after setup)
              </summary>
              <div style={{ marginTop: 8, padding: 10, background: "var(--surface-2)", borderRadius: 6, border: "1px dashed var(--border-violet)" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.7, marginBottom: 8 }}>
                  <strong style={{ color: "var(--text-secondary)" }}>Step 1:</strong> Click "Copy Bookmarklet" below — the code is copied to your clipboard<br/>
                  <strong style={{ color: "var(--text-secondary)" }}>Step 2:</strong> Add a new bookmark in your browser (Ctrl+D in Chrome, then "More...")<br/>
                  <strong style={{ color: "var(--text-secondary)" }}>Step 3:</strong> Name it "Import to CodeOn", paste the copied code as the URL<br/>
                  <strong style={{ color: "var(--text-secondary)" }}>Step 4:</strong> Open any Codeforces problem page in your browser<br/>
                  <strong style={{ color: "var(--text-secondary)" }}>Step 5:</strong> Click the "Import to CodeOn" bookmark — problem + editorial sent automatically<br/>
                  <strong style={{ color: "var(--text-secondary)" }}>Step 6:</strong> The problem appears here instantly — no copy-paste needed
                </div>
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    navigator.clipboard.writeText(BOOKMARKLET_CODE).then(() => {
                      alert("Bookmarklet code copied!\n\nNow:\n1. Add a new bookmark in your browser\n2. Name it 'Import to CodeOn'\n3. Paste the copied code as the URL\n4. Click it on any Codeforces problem page");
                    }).catch(() => {
                      prompt("Copy this code and paste it as a new bookmark URL:", BOOKMARKLET_CODE);
                    });
                  }}
                  style={{
                    padding: "6px 14px", borderRadius: 6, border: "none",
                    background: "linear-gradient(135deg, #7c3aed, #4f46e5)", color: "white",
                    fontSize: 12, fontWeight: 700, cursor: "pointer",
                    boxShadow: "0 2px 8px rgba(124,58,237,0.3)",
                    fontFamily: "inherit",
                  }}
                >
                  Copy Bookmarklet
                </button>
              </div>
            </details>

            <button
              onClick={() => { setShowManualPaste(false); setBlockedUrl(null); setScrapeError(null); }}
              style={{
                marginTop: 10, padding: "5px 10px", borderRadius: 5, border: "1px solid var(--border-default)",
                background: "var(--surface-2)", color: "var(--text-muted)",
                fontSize: 11, cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {!problem ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", padding: 20, textAlign: "center", color: "var(--text-muted)" }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🎯</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>No Problem Loaded</div>
          <div style={{ fontSize: 13, maxWidth: 300, lineHeight: 1.5 }}>
            Paste a Codeforces or LeetCode URL above to import a problem and start solving.
          </div>
        </div>
      ) : (
        <>
          {/* Header */}
          <div style={{ padding: "14px 20px 0", borderBottom: "1px solid var(--border-subtle)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <h1 style={{ fontSize: 15, fontWeight: 700, flex: 1, color: "var(--text-primary)", lineHeight: 1.3 }}>
                {problem.title}
              </h1>
              <span className={`tag tag-${problem.difficulty === "easy" ? "emerald" : problem.difficulty === "medium" ? "amber" : "rose"}`}>
                {problem.difficulty}
              </span>
            </div>
            {!externalTab && (
            <div style={{ display: "flex", gap: 2 }}>
              {(["statement", "trail", "editorial"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  style={{
                    padding: "7px 14px",
                    background: "none", border: "none",
                    fontSize: 12, fontWeight: 500, cursor: "pointer",
                    color: tab === t ? "var(--brand-violet-light)" : "var(--text-muted)",
                    borderBottom: `2px solid ${tab === t ? "var(--brand-violet)" : "transparent"}`,
                    transition: "all 0.15s",
                    textTransform: "capitalize",
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
            )}
          </div>

          {/* Content */}
          <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
            {tab === "statement" && (
              <div className="animate-fade-in">
                {/* Source & Tags */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 6 }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "JetBrains Mono", textTransform: "capitalize" }}>
                    {problem.source}
                  </div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {problem.tags?.map((tag) => (
                      <span key={tag} className="tag tag-cyan">{tag.replace(/_/g, " ")}</span>
                    ))}
                  </div>
                </div>

                {/* Statement */}
                <div style={{ marginBottom: 20 }}>
                  <ProblemStatementView content={problem.content.problemStatementMarkdown} />
                </div>

                {/* Constraints */}
                {problem.content.constraintsMarkdown && (
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      Constraints
                    </div>
                    <ProblemStatementView content={problem.content.constraintsMarkdown} />
                  </div>
                )}

                {/* Examples */}
                {problem.examples && problem.examples.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      Sample Examples ({problem.examples.length})
                    </div>
                    {problem.examples.map((ex, i) => (
                      <div key={i} style={{
                        marginBottom: 12, padding: 12, background: "var(--surface-2)",
                        borderRadius: 8, border: "1px solid var(--border-subtle)"
                      }}>
                        <div style={{ marginBottom: 6 }}>
                          <span style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase" }}>Input</span>
                          <pre style={{
                            fontSize: 12, fontFamily: "JetBrains Mono", color: "var(--brand-cyan)",
                            background: "var(--surface-3)", padding: "6px 8px", borderRadius: 4, margin: "4px 0 0",
                            whiteSpace: "pre-wrap", wordBreak: "break-all"
                          }}>{ex.input}</pre>
                        </div>
                        <div style={{ marginBottom: 6 }}>
                          <span style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase" }}>Output</span>
                          <pre style={{
                            fontSize: 12, fontFamily: "JetBrains Mono", color: "var(--brand-emerald)",
                            background: "var(--surface-3)", padding: "6px 8px", borderRadius: 4, margin: "4px 0 0",
                            whiteSpace: "pre-wrap", wordBreak: "break-all"
                          }}>{ex.output}</pre>
                        </div>
                        {ex.explanation && (
                          <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 6, marginTop: 6 }}>
                            <ProblemStatementView content={ex.explanation} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === "trail" && (
              <div className="animate-fade-in">
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>
                    Optimization Trail
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    Target progression for {problem.title} {(problem.tags || []).join(", ") || "General"}.
                  </div>
                </div>
                {getOptimizationTrail(problem.tags || [], problem.difficulty || "medium").map((step, i) => (
                  <div key={step.level} style={{ display: "flex", gap: 12, marginBottom: 16 }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: "50%",
                      background: step.done ? "var(--brand-emerald)" : step.current ? "var(--brand-violet)" : "var(--surface-4)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, color: "white", fontWeight: 700, flexShrink: 0
                    }}>
                      {step.done ? "✓" : i + 1}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: step.current ? 600 : 400, color: step.current ? "var(--text-primary)" : "var(--text-muted)" }}>
                        {step.desc} <span style={{ color: "var(--brand-cyan)", fontFamily: "JetBrains Mono", fontSize: 11 }}>({step.label})</span>
                      </div>
                      {step.current && (
                        <div style={{ fontSize: 11, color: "var(--brand-violet-light)", marginTop: 2 }}>← Current target</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === "editorial" && (
              <div className="animate-fade-in">
                <div style={{ padding: "16px", background: "var(--surface-2)", borderRadius: 10, border: "1px solid var(--border-subtle)" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>
                    Scraped Editorial & Optimal Strategy
                  </div>
                  {problem.content.editorialMarkdown ? (
                    <ProblemStatementView content={problem.content.editorialMarkdown} />
                  ) : (
                    <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7 }}>
                      Editorial not available. The AI mentor uses ground-truth solutions to guide your hints step-by-step.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
