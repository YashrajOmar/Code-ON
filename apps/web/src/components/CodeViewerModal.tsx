"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import Editor from "@monaco-editor/react";

interface CodeViewerModalProps {
  url: string | null;
  onClose: () => void;
}

export default function CodeViewerModal({ url, onClose }: CodeViewerModalProps) {
  const [code, setCode] = useState<string | null>(null);
  const [language, setLanguage] = useState<string>("cpp");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const fetchCode = useCallback(async (playgroundUrl: string) => {
    setLoading(true);
    setError(null);
    setCode(null);
    try {
      const res = await fetch(`/api/playground?url=${encodeURIComponent(playgroundUrl)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load code.");
      } else {
        setCode(data.code);
        setLanguage(data.language || "cpp");
      }
    } catch {
      setError("Network error while fetching code.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (url) fetchCode(url);
  }, [url, fetchCode]);

  // Lock ALL scroll while modal is open + close on Escape
  useEffect(() => {
    if (!url) return;
    // Inject a global style that hides overflow + scrollbars on everything
    const style = document.createElement("style");
    style.id = "codeon-modal-scroll-lock";
    style.textContent = `
      html, body { overflow: hidden !important; }
      ::-webkit-scrollbar { display: none !important; }
      * { scrollbar-width: none !important; }
    `;
    document.head.appendChild(style);
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => {
      document.getElementById("codeon-modal-scroll-lock")?.remove();
      window.removeEventListener("keydown", handler);
    };
  }, [url, onClose]);

  if (!url) return null;

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.92)",
        backdropFilter: "blur(8px)",
        zIndex: 2147483647,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: isFullscreen ? 0 : "24px",
        overflow: "hidden",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: isFullscreen ? "100vw" : "min(820px, 92vw)",
          height: isFullscreen ? "100vh" : "min(560px, 86vh)",
          background: "var(--surface-1)",
          borderRadius: isFullscreen ? 0 : "12px",
          border: "1px solid var(--border-default)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        {/* Header bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 14px",
            borderBottom: "1px solid var(--border-subtle)",
            background: "var(--surface-2)",
            flexShrink: 0,
            height: 40,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14, opacity: 0.7 }}>{"</>"}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
              Implementation Code
            </span>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              style={btnStyle}
            >
              {isFullscreen ? "⤢" : "⤡"}
            </button>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              title="Open on LeetCode in new tab"
              style={{ ...btnStyle, textDecoration: "none", color: "var(--brand-cyan)" }}
            >
              ↗ Open
            </a>
            <button onClick={onClose} title="Close" style={btnStyle}>
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
          {loading && (
            <div style={centerStyle}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="spinner" style={spinnerStyle} />
                <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  Fetching implementation code...
                </span>
              </div>
            </div>
          )}

          {error && !loading && (
            <div style={{ ...centerStyle, flexDirection: "column", gap: 16 }}>
              <div style={{ fontSize: 32, opacity: 0.4 }}>{"</>"}</div>
              <div style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 400, textAlign: "center", lineHeight: 1.6 }}>
                {error}
              </div>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  padding: "9px 20px",
                  borderRadius: 8,
                  background: "linear-gradient(135deg, var(--brand-violet), var(--brand-indigo))",
                  color: "white",
                  fontSize: 12,
                  fontWeight: 600,
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                Open on LeetCode ↗
              </a>
            </div>
          )}

          {code && !loading && !error && (
            <Editor
              value={code}
              language={language}
              theme="vs-dark"
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize: 13,
                fontFamily: "JetBrains Mono, monospace",
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                automaticLayout: true,
                wordWrap: "on",
                padding: { top: 12, bottom: 12 },
                scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
              }}
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

const btnStyle: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: 6,
  border: "1px solid var(--border-default)",
  background: "var(--surface-3)",
  color: "var(--text-secondary)",
  fontSize: 12,
  cursor: "pointer",
  fontWeight: 500,
  display: "inline-flex",
  alignItems: "center",
  lineHeight: 1,
};

const centerStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const spinnerStyle: React.CSSProperties = {
  display: "inline-block",
  width: 14,
  height: 14,
  border: "2px solid rgba(255,255,255,0.15)",
  borderTopColor: "var(--brand-violet)",
  borderRadius: "50%",
  animation: "spin 1s linear infinite",
};
