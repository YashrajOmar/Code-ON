"use client";

import { useState, useEffect } from "react";

/**
 * Inline tooltips bound to page elements — not ordered steps.
 * Each tooltip finds its element independently and stays until dismissed.
 * User can dismiss individual tooltips or skip all.
 */

const TOOLTIP_KEY = "codeon_tooltips_done";

interface TooltipSpot {
  id: string;
  selector: string;
  title: string;
  body: string;
  position: "top" | "bottom" | "left" | "right";
}

const TOOLTIPS: TooltipSpot[] = [
  {
    id: "import-url",
    selector: 'input[placeholder*="LeetCode"], input[placeholder*="Codeforces"]',
    title: "Import a Problem",
    body: "Paste a Codeforces or LeetCode URL here, then click Import. CodeOn will scrape the problem statement, editorial, and reference solutions.",
    position: "bottom",
  },
  {
    id: "editor",
    selector: '.monaco-editor, [class*="monaco"]',
    title: "Write Your Code",
    body: "Write your solution here. Click Run to test against sample cases.",
    position: "left",
  },
  {
    id: "ai-hints",
    selector: 'textarea[placeholder*="Ask a question"], textarea[placeholder*="share your thinking"]',
    title: "Ask AI for Help",
    body: "Type a question here, or click 'Give me a hint' above. The AI knows your coding style and the editorial.",
    position: "left",
  },
  {
    id: "settings-gear",
    selector: 'aside button[title="Settings"]',
    title: "Configure Everything",
    body: "Click the gear icon to add your AI API key, connect coding profiles, generate a companion token, and train your AI mentor.",
    position: "right",
  },
];

export default function InlineTooltips() {
  const [activeTooltips, setActiveTooltips] = useState<Set<string>>(new Set());
  const [positions, setPositions] = useState<Record<string, DOMRect>>({});

  useEffect(() => {
    try {
      const done = localStorage.getItem(TOOLTIP_KEY);
      if (done) return;
    } catch {
      return;
    }

    setTimeout(() => {
      const found = new Set<string>();
      const pos: Record<string, DOMRect> = {};
      for (const tip of TOOLTIPS) {
        const el = document.querySelector(tip.selector);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            found.add(tip.id);
            pos[tip.id] = rect;
          }
        }
      }
      if (found.size > 0) {
        setActiveTooltips(found);
        setPositions(pos);
      }
    }, 5000);
  }, []);

  useEffect(() => {
    if (activeTooltips.size === 0) return;
    const handler = () => {
      const pos: Record<string, DOMRect> = {};
      for (const tip of TOOLTIPS) {
        if (!activeTooltips.has(tip.id)) continue;
        const el = document.querySelector(tip.selector);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            pos[tip.id] = rect;
          }
        }
      }
      setPositions(pos);
    };
    window.addEventListener("resize", handler);
    window.addEventListener("scroll", handler, true);
    return () => {
      window.removeEventListener("resize", handler);
      window.removeEventListener("scroll", handler, true);
    };
  }, [activeTooltips]);

  function dismiss(id: string) {
    const next = new Set(activeTooltips);
    next.delete(id);
    setActiveTooltips(next);
    if (next.size === 0) {
      try { localStorage.setItem(TOOLTIP_KEY, "true"); } catch {}
    }
  }

  function dismissAll() {
    setActiveTooltips(new Set());
    try { localStorage.setItem(TOOLTIP_KEY, "true"); } catch {}
  }

  if (activeTooltips.size === 0) return null;

  return (
    <>
      <div
        onClick={dismissAll}
        style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.5)",
          zIndex: 2147483644,
          pointerEvents: "auto",
        }}
      />

      {TOOLTIPS.filter(t => activeTooltips.has(t.id)).map(tip => {
        const rect = positions[tip.id];
        if (!rect) return null;

        let style: React.CSSProperties = { position: "fixed", zIndex: 2147483646 };
        if (tip.position === "bottom") {
          style = { ...style, top: rect.bottom + 12, left: rect.left + rect.width / 2 - 140 };
        } else if (tip.position === "left") {
          style = { ...style, top: rect.top + rect.height / 2 - 50, left: Math.max(10, rect.left - 300) };
        } else if (tip.position === "right") {
          style = { ...style, top: rect.top + rect.height / 2 - 50, left: rect.right + 12 };
        } else {
          style = { ...style, top: Math.max(10, rect.top - 120), left: rect.left + rect.width / 2 - 140 };
        }

        const highlightStyle: React.CSSProperties = {
          position: "fixed",
          top: rect.top - 4, left: rect.left - 4,
          width: rect.width + 8, height: rect.height + 8,
          border: "2px solid var(--brand-violet)",
          borderRadius: 8,
          boxShadow: "0 0 20px rgba(124,58,237,0.4)",
          pointerEvents: "none",
          zIndex: 2147483645,
        };

        let arrowStyle: React.CSSProperties = {};
        if (tip.position === "bottom") {
          arrowStyle = { top: -8, left: "50%", transform: "translateX(-50%)", borderBottom: "8px solid var(--surface-2)" };
        } else if (tip.position === "left") {
          arrowStyle = { right: -8, top: "50%", transform: "translateY(-50%)", borderRight: "8px solid var(--surface-2)" };
        } else if (tip.position === "right") {
          arrowStyle = { left: -8, top: "50%", transform: "translateY(-50%)", borderLeft: "8px solid var(--surface-2)" };
        }

        return (
          <div key={tip.id} style={{ position: "fixed", zIndex: 2147483646 }}>
            <div style={highlightStyle} />
            <div
              style={{
                ...style,
                width: 280,
                background: "var(--surface-2)",
                border: "1px solid var(--border-violet)",
                borderRadius: 10,
                padding: 16,
                boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                pointerEvents: "auto",
              }}
            >
              <div style={{
                position: "absolute",
                width: 0, height: 0,
                border: "8px solid transparent",
                ...arrowStyle,
              }} />
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>
                {tip.title}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 14 }}>
                {tip.body}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button onClick={() => dismiss(tip.id)} style={{
                  padding: "5px 12px", borderRadius: 6, border: "none",
                  background: "linear-gradient(135deg, var(--brand-violet), var(--brand-indigo))",
                  color: "white", fontSize: 11, fontWeight: 600, cursor: "pointer",
                }}>
                  Got it
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
