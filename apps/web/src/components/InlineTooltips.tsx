"use client";

import { useState, useEffect } from "react";

/**
 * Inline tooltips that point at specific UI elements on first visit.
 * Shows arrows + explanations for: problem import, editor, AI hints, trail tab.
 * Uses localStorage to only show once.
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
    selector: 'input[placeholder*="Paste LeetCode"], input[placeholder*="LeetCode"]',
    title: "Import a Problem",
    body: "Paste a Codeforces or LeetCode URL here, then click Import. CodeOn will scrape the problem statement, editorial, and reference solutions.",
    position: "bottom",
  },
  {
    id: "editor",
    selector: '.monaco-editor, [class*="monaco"]',
    title: "Write Your Code",
    body: "Write your solution here. Click Run to test against sample cases. CodeOn compiles and runs it instantly.",
    position: "left",
  },
  {
    id: "ai-hints",
    selector: 'textarea[placeholder*="Ask a question"], textarea[placeholder*="share your thinking"]',
    title: "Ask AI for Help",
    body: "Type a question here, or click 'Give me a hint' above for a Socratic nudge. The AI knows your coding style and the editorial.",
    position: "left",
  },
  {
    id: "trail-tab",
    selector: 'button',
    title: "Optimization Trail",
    body: "Click the Trail tab (top left) to see a step-by-step path from brute force to the optimal solution, based on the editorial.",
    position: "right",
  },
  {
    id: "settings-gear",
    selector: 'aside button[title="Settings"]',
    title: "Configure Everything",
    body: "Click the gear icon (bottom left) to add your AI API key, connect coding profiles, and paste solutions to train your AI mentor.",
    position: "right",
  },
];

export default function InlineTooltips() {
  const [currentStep, setCurrentStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const [element, setElement] = useState<DOMRect | null>(null);

  useEffect(() => {
    try {
      const done = localStorage.getItem(TOOLTIP_KEY);
      if (done) return;
    } catch {
      return;
    }

    // Wait for the IDE to fully load
    setTimeout(() => {
      setVisible(true);
      updatePosition();
    }, 5000);
  }, []);

  useEffect(() => {
    if (!visible) return;
    updatePosition();
  }, [currentStep, visible]);

  useEffect(() => {
    if (!visible) return;
    const handler = () => updatePosition();
    window.addEventListener("resize", handler);
    window.addEventListener("scroll", handler, true);
    return () => {
      window.removeEventListener("resize", handler);
      window.removeEventListener("scroll", handler, true);
    };
  }, [visible, currentStep]);

  function updatePosition() {
    const tooltip = TOOLTIPS[currentStep];
    if (!tooltip) return;

    try {
      const el = document.querySelector(tooltip.selector);
      if (el) {
        const rect = el.getBoundingClientRect();
        // Verify the element is actually visible (not display:none)
        if (rect.width > 0 && rect.height > 0) {
          setElement(rect);
          return;
        }
      }
      // Element not found or hidden — skip to next
      if (currentStep < TOOLTIPS.length - 1) {
        setCurrentStep(currentStep + 1);
      } else {
        finish();
      }
    } catch {
      setElement(null);
    }
  }

  function finish() {
    try { localStorage.setItem(TOOLTIP_KEY, "true"); } catch {}
    setVisible(false);
  }

  function next() {
    if (currentStep < TOOLTIPS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      finish();
    }
  }

  function skip() {
    finish();
  }

  if (!visible || !element) return null;

  const tooltip = TOOLTIPS[currentStep];
  const isLast = currentStep === TOOLTIPS.length - 1;

  let style: React.CSSProperties = { position: "fixed", zIndex: 2147483646 };

  if (tooltip.position === "bottom") {
    style = { ...style, top: element.bottom + 12, left: element.left + element.width / 2 - 140 };
  } else if (tooltip.position === "left") {
    style = { ...style, top: element.top + element.height / 2 - 50, left: Math.max(10, element.left - 300) };
  } else if (tooltip.position === "right") {
    style = { ...style, top: element.top + element.height / 2 - 50, left: element.right + 12 };
  } else {
    style = { ...style, top: Math.max(10, element.top - 120), left: element.left + element.width / 2 - 140 };
  }

  // Highlight box around the target element
  const highlightStyle: React.CSSProperties = {
    position: "fixed",
    top: element.top - 4,
    left: element.left - 4,
    width: element.width + 8,
    height: element.height + 8,
    border: "2px solid var(--brand-violet)",
    borderRadius: 8,
    boxShadow: "0 0 20px rgba(124,58,237,0.4)",
    pointerEvents: "none",
    zIndex: 2147483645,
    transition: "all 0.3s ease",
  };

  // Arrow
  let arrowStyle: React.CSSProperties = {};
  if (tooltip.position === "bottom") {
    arrowStyle = { top: -8, left: "50%", transform: "translateX(-50%)", borderBottom: "8px solid var(--surface-2)" };
  } else if (tooltip.position === "left") {
    arrowStyle = { right: -8, top: "50%", transform: "translateY(-50%)", borderRight: "8px solid var(--surface-2)" };
  } else if (tooltip.position === "right") {
    arrowStyle = { left: -8, top: "50%", transform: "translateY(-50%)", borderLeft: "8px solid var(--surface-2)" };
  }

  return (
    <>
      {/* Dim background */}
      <div
        onClick={skip}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.5)",
          zIndex: 2147483644,
          pointerEvents: "auto",
        }}
      />

      {/* Highlight box */}
      <div style={highlightStyle} />

      {/* Tooltip card */}
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
        {/* Arrow */}
        <div
          style={{
            position: "absolute",
            width: 0,
            height: 0,
            border: "8px solid transparent",
            ...arrowStyle,
          }}
        />

        {/* Content */}
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>
          {tooltip.title}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 14 }}>
          {tooltip.body}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 4 }}>
            {TOOLTIPS.map((_, i) => (
              <div key={i} style={{
                width: 6, height: 6, borderRadius: "50%",
                background: i === currentStep ? "var(--brand-violet)" : "var(--surface-4)",
              }} />
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={skip} style={{
              background: "none", border: "none", color: "var(--text-muted)",
              fontSize: 11, cursor: "pointer",
            }}>
              Skip
            </button>
            <button onClick={next} style={{
              padding: "5px 12px", borderRadius: 6, border: "none",
              background: "linear-gradient(135deg, var(--brand-violet), var(--brand-indigo))",
              color: "white", fontSize: 11, fontWeight: 600, cursor: "pointer",
            }}>
              {isLast ? "Done" : "Next →"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
