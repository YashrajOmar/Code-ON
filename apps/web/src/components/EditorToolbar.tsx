"use client";

import {
  useIDEStore,
  SUPPORTED_LANGUAGES,
  getFileName,
} from "@/store/useIDEStore";

interface EditorToolbarProps {
  onRun?: () => void;
}

export default function EditorToolbar({ onRun }: EditorToolbarProps) {
  const { language, setLanguage, isRunning, verdict, verdictMessage, resetToTemplate } =
    useIDEStore();

  const fileName = getFileName(language);

  return (
    <div
      style={{
        padding: "8px 14px",
        borderBottom: "1px solid var(--border-subtle)",
        background: "var(--surface-1)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      {/* File Tab Info */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            background: "var(--surface-2)",
            border: "1px solid var(--border-default)",
            borderRadius: 6,
            fontSize: 12,
            fontFamily: "JetBrains Mono, monospace",
            color: "var(--text-primary)",
            fontWeight: 500,
          }}
        >
          <span style={{ fontSize: 13 }}>📄</span>
          <span>{fileName}</span>
        </div>

        <button
          onClick={resetToTemplate}
          title="Reset code to starter template"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 11,
            padding: "4px 6px",
            borderRadius: 4,
            display: "flex",
            alignItems: "center",
            gap: 4,
            transition: "color 0.15s ease",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--brand-violet-light)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
        >
          ↺ Reset
        </button>
      </div>

      {/* Language Selector, Verdict & Actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {/* Global Verdict Badge */}
        {verdict && (
          <div
            style={{
              padding: "3px 8px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
              fontFamily: "JetBrains Mono, monospace",
              display: "flex",
              alignItems: "center",
              gap: 4,
              background:
                verdict === "AC"
                  ? "rgba(16,185,129,0.15)"
                  : "rgba(244,63,94,0.15)",
              color:
                verdict === "AC"
                  ? "var(--brand-emerald)"
                  : "var(--brand-rose)",
              border: `1px solid ${
                verdict === "AC"
                  ? "rgba(16,185,129,0.3)"
                  : "rgba(244,63,94,0.3)"
              }`,
            }}
            title={verdictMessage || undefined}
          >
            {verdict === "AC" ? "✓ AC" : `✗ ${verdict}`}
          </div>
        )}

        {/* Global Workspace Language Selector */}
        <div style={{ position: "relative" }}>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={isRunning}
            style={{
              appearance: "none",
              WebkitAppearance: "none",
              padding: "5px 28px 5px 10px",
              fontSize: 12,
              fontFamily: "JetBrains Mono, monospace",
              fontWeight: 500,
              background: "var(--surface-2)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-default)",
              borderRadius: 6,
              cursor: isRunning ? "not-allowed" : "pointer",
              outline: "none",
              transition: "all 0.15s ease",
            }}
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang} value={lang} style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}>
                {lang}
              </option>
            ))}
          </select>
          <span
            style={{
              position: "absolute",
              right: 8,
              top: "50%",
              transform: "translateY(-50%)",
              pointerEvents: "none",
              fontSize: 9,
              color: "var(--text-muted)",
            }}
          >
            ▼
          </span>
        </div>

        {/* Run Button */}
        {onRun && (
          <button
            onClick={onRun}
            disabled={isRunning}
            className="btn btn-primary"
            style={{
              padding: "5px 14px",
              fontSize: 12,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: 6,
              cursor: isRunning ? "not-allowed" : "pointer",
            }}
          >
            {isRunning ? (
              <>
                <span
                  style={{
                    display: "inline-block",
                    width: 10,
                    height: 10,
                    border: "2px solid rgba(255,255,255,0.3)",
                    borderTopColor: "white",
                    borderRadius: "50%",
                    animation: "spin 0.8s linear infinite",
                  }}
                />
                Running…
              </>
            ) : (
              <>
                <span>▶</span> Run
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
