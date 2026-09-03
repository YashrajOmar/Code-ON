"use client";

import { useState, useEffect, useRef } from "react";
import { useIDEStore } from "@/store/useIDEStore";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const DEMO_HINTS: any[] = [];

const HINT_TYPES: Record<string, { label: string; color: string }> = {
  complexity_question: { label: "Complexity", color: "var(--brand-amber)" },
  optimization_question: { label: "Optimization", color: "var(--brand-violet-light)" },
  edge_case_probe: { label: "Edge Case", color: "var(--brand-rose)" },
  data_structure_nudge: { label: "Data Structure", color: "var(--brand-cyan)" },
  encouragement: { label: "Progress", color: "var(--brand-emerald)" },
  style_suggestion: { label: "Style", color: "var(--brand-indigo)" },
};

const STUDENT_PROFILE = {
  elo: 1247,
  teachingStyle: "socratic",
  trailLevel: "brute_force",
  hintsToday: 2,
  styleStage: "modern",
};

interface HintPanelProps {
  problemTitle?: string;
  problemUrl?: string;
  problemStatement?: string;
  problemTags?: string[];
  editorialMarkdown?: string;
  referenceSolutions?: any[];
}

export default function HintPanel({ problemTitle, problemUrl, problemStatement, problemTags, editorialMarkdown, referenceSolutions }: HintPanelProps) {
  const { code: editorCode, language: editorLang } = useIDEStore();
  const [hints, setHints] = useState(DEMO_HINTS);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamedText, setStreamedText] = useState("");
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [policyDecision, setPolicyDecision] = useState<string | null>(null);
  const [toastError, setToastError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // ── Persist conversation to localStorage (survives refresh/back-button) ──────
  const conversationKey = problemUrl ? `codeon_hints_${problemUrl}` : 'codeon_hints_default';

  // Load conversation from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(conversationKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setHints(parsed);
        }
      }
    } catch {}
  }, [conversationKey]);

  // Save conversation to localStorage whenever hints change
  useEffect(() => {
    try {
      if (hints.length > 0) {
        localStorage.setItem(conversationKey, JSON.stringify(hints));
      }
    } catch {}
  }, [hints, conversationKey]);

  // Automatically hide toast after 5s
  useEffect(() => {
    if (toastError) {
      const timer = setTimeout(() => setToastError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toastError]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [hints, streamedText]);

  async function streamHint(content: string) {
    setIsStreaming(true);
    setStreamedText("");
    const words = content.split(" ");
    for (let i = 0; i <= words.length; i++) {
      await new Promise((r) => setTimeout(r, 35 + Math.random() * 40));
      setStreamedText(words.slice(0, i).join(" "));
    }
    setIsStreaming(false);
    return content;
  }

  // Build conversation messages array from hints state
  function buildMessages(): Array<{ role: "user" | "assistant"; content: string }> {
    return hints
      .filter((h) => {
        const type = (h as { type: string }).type;
        return type === "student" || type !== undefined;
      })
      .map((h) => {
        const type = (h as { type: string }).type;
        if (type === "student") {
          return { role: "user" as const, content: (h as { content: string }).content };
        }
        return { role: "assistant" as const, content: (h as { content: string }).content };
      });
  }

  async function requestHint() {
    if (isThinking || isStreaming) return;
    setIsThinking(true);
    setPolicyDecision("Evaluating pedagogical policy & invoking Gemini AI…");

    try {
      const res = await fetch("/api/hint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: editorCode || "// No code entered",
          language: editorLang.toLowerCase().replace(/[^a-z0-9]/g, "") || "cpp17",
          problemTitle: problemTitle || "No problem loaded",
          problemUrl: problemUrl,
          problemStatement: problemStatement || "No problem statement",
          problemTags: problemTags || [],
          userMessage: input.trim() || "Give me a Socratic hint for my current approach.",
          messages: buildMessages(),
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        setIsThinking(false);
        setPolicyDecision(null);
        setToastError(errJson.message || errJson.error || "AI Assistant is currently unavailable.");
        return;
      }

      setIsThinking(false);
      setIsStreaming(true);
      setStreamedText("");

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

      setIsStreaming(false);
      setHints((prev) => [
        ...prev,
        {
          id: Date.now(),
          type: "optimization_question",
          content: fullText,
          ts: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          isNew: true,
        },
      ]);
      setStreamedText("");
      setPolicyDecision(null);
    } catch {
      setIsThinking(false);
      setPolicyDecision(null);
      setToastError("⚠️ Failed to connect to AI mentor. Please check your API key in Settings.");
    }
  }

  async function handleSend() {
    const msg = input.trim();
    if (!msg || isThinking || isStreaming) return;
    setInput("");
    setIsThinking(true);

    setHints((prev) => [
      ...prev,
      { id: Date.now(), type: "student", content: msg, ts: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), isNew: true },
    ]);

    try {
      const res = await fetch("/api/hint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: editorCode || "// No code entered",
          language: editorLang.toLowerCase().replace(/[^a-z0-9]/g, "") || "cpp17",
          problemTitle: problemTitle || "No problem loaded",
          problemUrl: problemUrl,
          problemStatement: problemStatement || "No problem statement",
          problemTags: problemTags || [],
          userMessage: msg,
          messages: buildMessages(),
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        setIsThinking(false);
        setToastError(errJson.message || errJson.error || "AI Assistant is currently unavailable.");
        return;
      }

      setIsThinking(false);
      setIsStreaming(true);
      setStreamedText("");

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

      setIsStreaming(false);
      setHints((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          type: "complexity_question",
          content: fullText,
          ts: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          isNew: true,
        },
      ]);
      setStreamedText("");
    } catch {
      setIsThinking(false);
    }
  }

  function renderContent(text: string) {
    return <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...props }: any) {
          const isBlock = className?.includes("language-");
          if (isBlock) {
            return (
              <pre style={{
                background: "var(--surface-0)",
                borderRadius: 8,
                padding: 12,
                overflowX: "auto",
                margin: "8px 0",
                border: "1px solid var(--border-subtle)",
              }}>
                <code style={{
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: 12,
                  lineHeight: 1.5,
                  color: "var(--text-primary)",
                }} {...props}>{children}</code>
              </pre>
            );
          }
          return (
            <code style={{
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 12,
              background: "var(--surface-0)",
              padding: "2px 5px",
              borderRadius: 4,
              color: "var(--brand-cyan)",
            }} {...props}>{children}</code>
          );
        },
        p({ children }: any) {
          return <p style={{ margin: "4px 0" }}>{children}</p>;
        },
        ul({ children }: any) {
          return <ul style={{ margin: "4px 0", paddingLeft: 18 }}>{children}</ul>;
        },
        ol({ children }: any) {
          return <ol style={{ margin: "4px 0", paddingLeft: 18 }}>{children}</ol>;
        },
        strong({ children }: any) {
          return <strong style={{ color: "var(--text-primary)" }}>{children}</strong>;
        },
      }}
    >{text}</ReactMarkdown>;
  }

  return (
    <div style={{
      width: "100%",
      height: "100vh",
      display: "flex", flexDirection: "column",
      background: "var(--surface-1)",
      borderLeft: "1px solid var(--border-subtle)",
    }}>
      {/* Header */}
      <div style={{
        padding: "14px 18px",
        borderBottom: "1px solid var(--border-subtle)",
        display: "flex", alignItems: "center", gap: 10,
        flexShrink: 0,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: 10, flexShrink: 0,
          background: "linear-gradient(135deg, var(--brand-violet), var(--brand-indigo))",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, boxShadow: "var(--glow-violet)",
        }}>🎓</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>AI Mentor</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Socratic · Elo {STUDENT_PROFILE.elo}</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <span className="tag tag-violet">{STUDENT_PROFILE.trailLevel.replace("_", " ")}</span>
        </div>
      </div>

      {/* Student context card */}
      <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            Teaching style: <span style={{ color: "var(--brand-violet-light)", fontWeight: 500 }}>Socratic</span>
          </div>
          <span style={{ color: "var(--text-muted)" }}>·</span>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            Style: <span style={{ color: "var(--brand-cyan)", fontWeight: 500 }}>{STUDENT_PROFILE.styleStage}</span>
          </div>
          <span style={{ color: "var(--text-muted)" }}>·</span>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            Hints today: <span style={{ color: hints.filter(h => (h as { type: string }).type !== "student").length > 4 ? "var(--brand-rose)" : "var(--brand-emerald)", fontWeight: 500 }}>
              {hints.filter(h => (h as { type: string }).type !== "student").length}
            </span>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
        {hints.map((hint) => {
          const isStudent = (hint as { type: string }).type === "student";
          const hintMeta = HINT_TYPES[(hint as { type: string }).type] ?? { label: "Hint", color: "var(--text-muted)" };
          return (
            <div
              key={hint.id}
              className={hint.isNew ? "animate-fade-in" : ""}
              style={{
                marginBottom: 16,
                display: "flex",
                flexDirection: isStudent ? "row-reverse" : "row",
                gap: 10,
                alignItems: "flex-start",
              }}
            >
              {!isStudent && (
                <div style={{
                  width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                  background: "linear-gradient(135deg, var(--brand-violet), var(--brand-indigo))",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, marginTop: 2,
                }}>🎓</div>
              )}
              <div style={{ maxWidth: "85%" }}>
                {!isStudent && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: hintMeta.color, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      {hintMeta.label}
                    </span>
                    <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{hint.ts}</span>
                  </div>
                )}
                <div style={{
                  padding: "10px 14px",
                  borderRadius: isStudent ? "12px 4px 12px 12px" : "4px 12px 12px 12px",
                  background: isStudent
                    ? "linear-gradient(135deg, var(--brand-violet), var(--brand-indigo))"
                    : "var(--surface-3)",
                  border: isStudent ? "none" : "1px solid var(--border-subtle)",
                  fontSize: 13, lineHeight: 1.7,
                  color: isStudent ? "white" : "var(--text-secondary)",
                }} className="hint-text">
                  {renderContent(hint.content)}
                </div>
                {isStudent && (
                  <div style={{ textAlign: "right", marginTop: 3, fontSize: 10, color: "var(--text-muted)" }}>{hint.ts}</div>
                )}
              </div>
            </div>
          );
        })}

        {/* Streaming hint */}
        {isStreaming && streamedText && (
          <div className="animate-fade-in" style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8, flexShrink: 0,
              background: "linear-gradient(135deg, var(--brand-violet), var(--brand-indigo))",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, marginTop: 2,
            }}>🎓</div>
            <div style={{ maxWidth: "85%" }}>
              <div style={{
                padding: "10px 14px", borderRadius: "4px 12px 12px 12px",
                background: "var(--surface-3)", border: "1px solid var(--border-violet)",
                fontSize: 13, lineHeight: 1.7, color: "var(--text-secondary)",
              }} className="hint-text">
                {renderContent(streamedText)}
                <span style={{
                  display: "inline-block", width: 2, height: 14,
                  background: "var(--brand-violet-light)", marginLeft: 2,
                  animation: "typing-cursor 0.8s infinite",
                  verticalAlign: "text-bottom",
                }} />
              </div>
            </div>
          </div>
        )}

        {/* Thinking indicator */}
        {isThinking && (
          <div className="animate-fade-in" style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center" }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8, flexShrink: 0,
              background: "linear-gradient(135deg, var(--brand-violet), var(--brand-indigo))",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12,
            }}>🎓</div>
            <div style={{ padding: "8px 14px", background: "var(--surface-3)", borderRadius: "4px 12px 12px 12px", border: "1px solid var(--border-subtle)" }}>
              <div style={{ fontSize: 11, color: "var(--brand-violet-light)", fontFamily: "JetBrains Mono", marginBottom: 4 }}>
                {policyDecision ?? "Thinking…"}
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                {[0, 1, 2].map((i) => (
                  <div key={i} style={{
                    width: 5, height: 5, borderRadius: "50%",
                    background: "var(--brand-violet-light)",
                    animation: `bounce 1.2s ${i * 0.2}s infinite ease-in-out`,
                  }} />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Hint request button */}
      <div style={{ padding: "8px 16px 0", flexShrink: 0 }}>
        <button
          onClick={requestHint}
          disabled={isThinking || isStreaming}
          style={{
            width: "100%", padding: "9px 16px", borderRadius: 10,
            background: "rgba(124,58,237,0.12)",
            border: "1px solid var(--border-violet)",
            color: "var(--brand-violet-light)", fontSize: 12, fontWeight: 500,
            cursor: (isThinking || isStreaming) ? "not-allowed" : "pointer",
            opacity: (isThinking || isStreaming) ? 0.5 : 1,
            transition: "all 0.15s",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}
          onMouseEnter={e => { if (!isThinking && !isStreaming) { e.currentTarget.style.background = "rgba(124,58,237,0.2)"; } }}
          onMouseLeave={e => { e.currentTarget.style.background = "rgba(124,58,237,0.12)"; }}
        >
          💡 Give me a hint
        </button>
      </div>

      {/* Toast Error */}
      {toastError && (
        <div className="animate-fade-in" style={{ padding: "0 16px 8px" }}>
          <div style={{
            background: "rgba(244,63,94,0.15)",
            border: "1px solid rgba(244,63,94,0.3)",
            color: "var(--brand-rose)",
            padding: "8px 12px",
            borderRadius: 8,
            fontSize: 12,
            textAlign: "center"
          }}>
            {toastError}
          </div>
        </div>
      )}

      {/* Chat input */}
      <div style={{ padding: "10px 16px 14px", flexShrink: 0 }}>
        <div style={{
          display: "flex", gap: 8, alignItems: "flex-end",
          background: "var(--surface-3)",
          border: "1px solid var(--border-default)",
          borderRadius: 12, padding: "8px 12px",
          transition: "border-color 0.15s",
        }}>
          <textarea
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
            }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); (e.target as HTMLTextAreaElement).style.height = "38px"; } }}
            placeholder="Ask a question or share your thinking…"
            rows={1}
            style={{
              flex: 1, background: "none", border: "none", outline: "none",
              resize: "none", color: "var(--text-primary)", fontSize: 13,
              fontFamily: "Inter, sans-serif", lineHeight: 1.5,
              minHeight: 38, maxHeight: 120, overflowY: "auto",
              transition: "height 0.1s ease",
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isThinking || isStreaming}
            style={{
              width: 30, height: 30, borderRadius: 8, border: "none",
              background: (!input.trim() || isThinking || isStreaming) ? "var(--surface-4)" : "linear-gradient(135deg, var(--brand-violet), var(--brand-indigo))",
              color: "white",
              cursor: (!input.trim() || isThinking || isStreaming) ? "not-allowed" : "pointer",
              opacity: (!input.trim() || isThinking || isStreaming) ? 0.4 : 1,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 13, flexShrink: 0, transition: "all 0.15s",
            }}
          >↑</button>
        </div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", textAlign: "center", marginTop: 6 }}>
          Enter to send · Shift+Enter for new line
        </div>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
      `}</style>
    </div>
  );
}
