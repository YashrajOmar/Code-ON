"use client";

import { useState, useRef, useEffect } from "react";
import { useIDEStore } from "@/store/useIDEStore";
import ProblemStatementView from "@/components/ProblemStatementView";
import type { ProblemData } from "@/components/ProblemPanel";

interface TrailPanelProps {
  problem: ProblemData | null;
}

interface TrailStep {
  id: number;
  markdown: string;
}

export default function TrailPanel({ problem }: TrailPanelProps) {
  const { code: editorCode, language: editorLang } = useIDEStore();
  const [steps, setSteps] = useState<TrailStep[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamedText, setStreamedText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [steps, streamedText]);

  // Reset when problem changes
  useEffect(() => {
    setSteps([]);
    setStreamedText("");
    setError(null);
  }, [problem?.url]);

  async function generateTrail() {
    if (isGenerating || !problem) return;
    setIsGenerating(true);
    setError(null);
    setStreamedText("");

    try {
      const res = await fetch("/api/hint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: editorCode || "// No code entered",
          language: (editorLang || "cpp17").toLowerCase().replace(/[^a-z0-9]/g, ""),
          problemTitle: problem.title,
          problemUrl: problem.url,
          problemStatement: problem.content?.problemStatementMarkdown,
          problemTags: problem.tags || [],
          userMessage:
            "Show me the optimization path for this problem — from brute force to optimal. Explain each step simply, like you're talking to a friend. Use the editorial as your reference. Keep it concise and readable.",
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        setError(errJson.message || errJson.error || "Failed to generate optimization trail.");
        setIsGenerating(false);
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          fullText += chunk;
          setStreamedText(fullText);
        }
      }

      // REPLACE previous trail — only one trail visible at a time
      setSteps([{ id: Date.now(), markdown: fullText }]);
      setStreamedText("");
    } catch {
      setError("Failed to connect to AI mentor. Check your API key in Settings.");
    } finally {
      setIsGenerating(false);
    }
  }

  if (!problem) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 13 }}>
        Import a problem to generate an optimization trail.
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "14px 20px 0", flexShrink: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>
          Optimization Trail
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
          Socratic step-by-step path from your current approach to the optimal editorial solution.
        </div>
      </div>

      {/* Generate button */}
      {steps.length === 0 && !isGenerating && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 20 }}>
          <div style={{ fontSize: 40, opacity: 0.4 }}>🧭</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Generate Your Optimization Trail</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", maxWidth: 320, textAlign: "center", lineHeight: 1.6 }}>
            The AI will analyze your current code's complexity, cross-reference it with the editorial, and build a Socratic step-by-step path to the optimal solution.
          </div>
          <button
            onClick={generateTrail}
            style={{
              padding: "10px 24px", borderRadius: 10, border: "none",
              background: "linear-gradient(135deg, var(--brand-violet), var(--brand-indigo))",
              color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer",
              boxShadow: "0 4px 12px rgba(124,58,237,0.3)",
            }}
          >
            🧭 Generate Trail
          </button>
        </div>
      )}

      {/* Streaming content */}
      {(isGenerating || streamedText) && (
        <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 20px" }}>
          <div style={{
            padding: 16, borderRadius: 10,
            background: "var(--surface-2)",
            border: "1px solid var(--border-violet)",
          }}>
            {isGenerating && !streamedText && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <span className="spinner" style={{
                  display: "inline-block", width: 14, height: 14,
                  border: "2px solid rgba(255,255,255,0.15)",
                  borderTopColor: "var(--brand-violet)",
                  borderRadius: "50%", animation: "spin 1s linear infinite",
                }} />
                <span style={{ fontSize: 12, color: "var(--brand-violet-light)", fontFamily: "JetBrains Mono" }}>
                  Analyzing AST & editorial…
                </span>
              </div>
            )}
            {streamedText && (
              <ProblemStatementView content={streamedText} />
            )}
          </div>
        </div>
      )}

      {/* Completed steps */}
      {steps.length > 0 && (
        <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 20px" }}>
          {steps.map((step) => (
            <div key={step.id} style={{
              padding: 16, borderRadius: 10, marginBottom: 12,
              background: "var(--surface-2)",
              border: "1px solid var(--border-subtle)",
            }}>
              <ProblemStatementView content={step.markdown} />
            </div>
          ))}
          {/* Re-generate button */}
          <button
            onClick={generateTrail}
            disabled={isGenerating}
            style={{
              width: "100%", padding: "9px 16px", borderRadius: 10,
              background: "rgba(124,58,237,0.12)",
              border: "1px solid var(--border-violet)",
              color: "var(--brand-violet-light)", fontSize: 12, fontWeight: 500,
              cursor: isGenerating ? "not-allowed" : "pointer",
              opacity: isGenerating ? 0.5 : 1,
              marginTop: 8,
            }}
          >
            🔄 Regenerate Trail
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ padding: "0 20px 20px" }}>
          <div style={{
            background: "rgba(244,63,94,0.15)",
            border: "1px solid rgba(244,63,94,0.3)",
            color: "var(--brand-rose)",
            padding: "10px 14px", borderRadius: 8, fontSize: 12, textAlign: "center",
          }}>
            ⚠️ {error}
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
