"use client";

import { useRef, useEffect } from "react";
import { useProblemStore } from "@/store/useProblemStore";
import { useIDEStore, type Verdict } from "@/store/useIDEStore";
import EditorToolbar from "@/components/EditorToolbar";
import Editor, { useMonaco } from "@monaco-editor/react";

interface EditorPanelProps {
  problemTitle?: string;
  problemStatement?: string;
  examples?: Array<{ input: string; output: string; explanation?: string }>;
  activeTab?: "editor" | "testcases";
}

export default function EditorPanel({
  problemTitle,
  problemStatement,
  activeTab = "editor",
}: EditorPanelProps) {
  const {
    testCases,
    updateTestCaseOutput,
    addTestCase,
    deleteTestCase,
    resetTestCases,
    updateTestCaseInput,
    updateTestCaseExpected,
  } = useProblemStore();

  const {
    code,
    language,
    isRunning,
    setCode,
    setIsRunning,
    setVerdict,
  } = useIDEStore();

  const monaco = useMonaco();
  const lineCount = code.split("\n").length;

  const getMonacoLanguage = (lang: string) => {
    const l = lang.toLowerCase();
    if (l.includes('c++') || l.includes('cpp')) return 'cpp';
    if (l.includes('python')) return 'python';
    if (l.includes('java')) return 'java';
    return 'javascript';
  };

  useEffect(() => {
    if (monaco) {
      monaco.editor.defineTheme('codeon-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'comment', foreground: '8B949E', fontStyle: 'italic' },
          { token: 'keyword', foreground: 'FF7B72', fontStyle: 'bold' },
          { token: 'string', foreground: 'A5D6FF' },
        ],
        colors: {
          'editor.background': '#0D1117',
          'editor.lineHighlightBackground': '#161B22',
        },
      });
      monaco.editor.setTheme('codeon-dark');
    }
  }, [monaco]);

  async function handleRun() {
    if (isRunning) return;
    setIsRunning(true);

    // Reset statuses to IDLE before run
    testCases.forEach((tc) => updateTestCaseOutput(tc.id, "", "IDLE" as any));

    try {
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          language,
          problemTitle: problemTitle || "Unknown Problem",
          problemStatement: problemStatement || "No statement provided.",
          testCases: testCases.map((tc) => ({
            input: tc.input,
            expected: tc.expectedOutput,
          })),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        testCases.forEach((tc) =>
          updateTestCaseOutput(tc.id, err.message || "Compilation Error", "FAIL")
        );
        setVerdict("CE", err.message || "Compilation Error");
      } else {
        const json = await res.json();
        const v: Verdict = (json.verdict as Verdict) || "WA";

        if (json.results && Array.isArray(json.results)) {
          testCases.forEach((tc, idx) => {
            const resData = json.results[idx];
            const pass = resData ? resData.pass : v === "AC";
            const actual = resData
              ? resData.actual
              : v === "AC"
              ? tc.expectedOutput
              : "Wrong Output";
            updateTestCaseOutput(tc.id, actual, pass ? "PASS" : "FAIL");
          });
        } else {
          testCases.forEach((tc) => {
            const pass = v === "AC";
            const actual =
              v === "AC"
                ? tc.expectedOutput
                : "Simulation failed or wrong output";
            updateTestCaseOutput(tc.id, actual, pass ? "PASS" : "FAIL");
          });
        }

        // Compute verdict message
        if (v === "AC") {
          setVerdict("AC", "All test cases passed!");
        } else {
          const failIdx = testCases.findIndex((_, idx) => {
            if (json.results && json.results[idx]) {
              return !json.results[idx].pass;
            }
            return true;
          });
          const message = failIdx >= 0 ? `WA on Test ${failIdx + 1}` : "Wrong Answer";
          setVerdict(v, message);
        }
      }
    } catch (err: any) {
      testCases.forEach((tc) =>
        updateTestCaseOutput(tc.id, "Execution Error", "FAIL")
      );
      setVerdict("RE", err?.message || "Execution Error");
    } finally {
      setIsRunning(false);
    }
  }



  return (
    <div
      style={{
        flex: 1,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--surface-0)",
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      {/* Tab: Editor */}
      {activeTab === "editor" && (
        <>
          {/* Top Editor Toolbar with Language Selector */}
          <EditorToolbar onRun={handleRun} />

          {/* Editor Core */}
          <div
            style={{
              flex: 1,
              display: "flex",
              overflow: "hidden",
              position: "relative",
            }}
          >
            <Editor
              height="100%"
              language={getMonacoLanguage(language)}
              value={code}
              onChange={(val) => setCode(val || "")}
              options={{
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                fontLigatures: true,
                fontSize: 14,
                lineHeight: 24,
                minimap: { enabled: true, scale: 0.75 },
                smoothScrolling: true,
                cursorBlinking: 'smooth',
                cursorSmoothCaretAnimation: 'on',
                formatOnPaste: true,
                padding: { top: 16 },
                scrollBeyondLastLine: false,
                automaticLayout: true,
              }}
            />
          </div>

          {/* Editor Status Bar */}
          <div
            style={{
              height: 26,
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "0 16px",
              background: "var(--surface-1)",
              borderTop: "1px solid var(--border-subtle)",
              fontSize: 11,
              color: "var(--text-muted)",
              fontFamily: "JetBrains Mono, monospace",
              flexShrink: 0,
            }}
          >
            <span style={{ color: "var(--text-secondary)" }}>{language}</span>
            <span>·</span>
            <span>{lineCount} lines</span>
            <span>·</span>
            <span>{code.length} chars</span>
            <span style={{ flex: 1 }} />
            <span style={{ color: "var(--brand-violet-light)", fontWeight: 500 }}>
              codeOn
            </span>
          </div>
        </>
      )}

      {/* Tab: Test Cases Panel */}
      {activeTab === "testcases" && (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            background: "var(--surface-0)",
          }}
          className="animate-fade-in"
        >
          {/* Clean Test Cases Header */}
          <div
            style={{
              padding: "10px 16px",
              borderBottom: "1px solid var(--border-subtle)",
              background: "var(--surface-1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                }}
              >
                Test Cases ({testCases.length})
              </span>
              <button
                onClick={addTestCase}
                className="btn btn-secondary"
                style={{
                  padding: "4px 10px",
                  fontSize: 11,
                  fontWeight: 500,
                }}
              >
                + Add Case
              </button>
              <button
                onClick={resetTestCases}
                className="btn btn-secondary"
                style={{
                  padding: "4px 10px",
                  fontSize: 11,
                  fontWeight: 500,
                }}
              >
                Reset Default
              </button>
            </div>

          {/* Run All Button — removed, use the toolbar Run button instead */}
          </div>

          {/* Test Case List */}
          <div
            style={{
              flex: 1,
              padding: "16px 20px",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            {testCases.map((tc, i) => {
              const isPass = tc.status === "PASS";
              const isFail = tc.status === "FAIL";
              const isDone = isPass || isFail;
              const borderColor = isPass
                ? "rgba(16,185,129,0.3)"
                : isFail
                ? "rgba(244,63,94,0.3)"
                : "var(--border-default)";

              return (
                <div
                  key={tc.id}
                  style={{
                    padding: 14,
                    background: "var(--surface-2)",
                    borderRadius: 8,
                    border: `1px solid ${borderColor}`,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 2,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: 12,
                          fontFamily: "JetBrains Mono, monospace",
                          color: isPass
                            ? "var(--brand-emerald)"
                            : isFail
                            ? "var(--brand-rose)"
                            : "var(--text-primary)",
                        }}
                      >
                        {isPass ? "✓" : isFail ? "✗" : "•"} Case {i + 1}
                      </span>
                      {isDone && (
                        <span className={`tag tag-${isPass ? "emerald" : "rose"}`}>
                          {isPass ? "PASS" : "FAIL"}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => deleteTestCase(tc.id)}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "var(--text-muted)",
                        cursor: "pointer",
                        fontSize: 11,
                        padding: "2px 6px",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.color = "var(--brand-rose)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.color = "var(--text-muted)")
                      }
                    >
                      Delete
                    </button>
                  </div>

                  <div>
                    <div
                      style={{
                        fontSize: 10,
                        color: "var(--text-muted)",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        marginBottom: 4,
                      }}
                    >
                      Input
                    </div>
                    <textarea
                      value={tc.input}
                      onChange={(e) => updateTestCaseInput(tc.id, e.target.value)}
                      style={{
                        width: "100%",
                        fontFamily: "JetBrains Mono, monospace",
                        fontSize: 12,
                        background: "var(--surface-3)",
                        border: "1px solid var(--border-default)",
                        borderRadius: 6,
                        padding: "6px 10px",
                        color: "var(--text-secondary)",
                        outline: "none",
                        resize: "vertical",
                        minHeight: 50,
                      }}
                    />
                  </div>

                  <div>
                    <div
                      style={{
                        fontSize: 10,
                        color: "var(--text-muted)",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        marginBottom: 4,
                      }}
                    >
                      Expected Output
                    </div>
                    <textarea
                      value={tc.expectedOutput}
                      onChange={(e) =>
                        updateTestCaseExpected(tc.id, e.target.value)
                      }
                      style={{
                        width: "100%",
                        fontFamily: "JetBrains Mono, monospace",
                        fontSize: 12,
                        background: "var(--surface-3)",
                        border: "1px solid var(--border-default)",
                        borderRadius: 6,
                        padding: "6px 10px",
                        color: "var(--text-secondary)",
                        outline: "none",
                        resize: "vertical",
                        minHeight: 50,
                      }}
                    />
                  </div>

                  <div>
                    <div
                      style={{
                        fontSize: 10,
                        color: "var(--text-muted)",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        marginBottom: 4,
                      }}
                    >
                      Your Output
                    </div>
                    <pre
                      style={{
                        fontFamily: "JetBrains Mono, monospace",
                        fontSize: 12,
                        background: "var(--surface-3)",
                        border: "1px solid var(--border-default)",
                        borderRadius: 6,
                        padding: "6px 10px",
                        color:
                          tc.status === "PASS"
                            ? "var(--brand-emerald)"
                            : tc.status === "FAIL"
                            ? "var(--brand-rose)"
                            : "var(--text-secondary)",
                        margin: 0,
                        minHeight: 32,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                      }}
                    >
                      {tc.actualOutput || "—"}
                    </pre>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
