"use client";

import { useState, useEffect } from "react";

/**
 * OnboardingOverlay — first-time setup wizard.
 *
 * Shows on first visit (checks localStorage). Guides users through:
 *   1. What is CodeOn?
 *   2. Add your AI API key
 *   3. Train the AI with your solutions
 *   4. Import a problem and start solving
 *
 * After completing (or skipping), sets localStorage flag and never shows again.
 */

const STORAGE_KEY = "codeon_onboarding_done";

interface OnboardingOverlayProps {
  onComplete: () => void;
  onGoToSettings: () => void;
}

export default function OnboardingOverlay({ onComplete, onGoToSettings }: OnboardingOverlayProps) {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const done = localStorage.getItem(STORAGE_KEY);
      if (!done) setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  function finish() {
    try { localStorage.setItem(STORAGE_KEY, "true"); } catch {}
    setVisible(false);
    onComplete();
  }

  function skip() {
    try { localStorage.setItem(STORAGE_KEY, "skipped"); } catch {}
    setVisible(false);
    onComplete();
  }

  if (!visible) return null;

  const steps = [
    // Step 0: Welcome
    {
      icon: "🤖",
      title: "Welcome to CodeOn",
      body: (
        <div style={{ fontSize: 14, lineHeight: 1.8, color: "var(--text-secondary)" }}>
          <p style={{ marginBottom: 14 }}>
            CodeOn is your <strong style={{ color: "var(--text-primary)" }}>personal AI coding mentor</strong>.
            It learns your coding style from your past submissions and gives you
            Socratic hints tailored to your skill level.
          </p>
          <p style={{ marginBottom: 14 }}>
            Here's how it works:
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ fontSize: 20 }}>🔗</span>
              <span>Paste a Codeforces or LeetCode problem URL to import it</span>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ fontSize: 20 }}>✍️</span>
              <span>Write your solution in the built-in editor</span>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ fontSize: 20 }}>💡</span>
              <span>Ask the AI mentor for hints — it knows your skill level</span>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ fontSize: 20 }}>🧭</span>
              <span>Follow the optimization trail from brute force to optimal</span>
            </div>
          </div>
        </div>
      ),
    },
    // Step 1: API Key
    {
      icon: "🔑",
      title: "Add Your AI API Key",
      body: (
        <div style={{ fontSize: 14, lineHeight: 1.8, color: "var(--text-secondary)" }}>
          <p style={{ marginBottom: 14 }}>
            CodeOn needs an AI API key to power your mentor. You can use:
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ fontSize: 16 }}>⚡</span>
              <span><strong style={{ color: "var(--text-primary)" }}>Google Gemini</strong> — free at aistudio.google.com</span>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ fontSize: 16 }}>🧠</span>
              <span><strong style={{ color: "var(--text-primary)" }}>OpenAI</strong> — platform.openai.com</span>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ fontSize: 16 }}>🔵</span>
              <span><strong style={{ color: "var(--text-primary)" }}>Custom (GLM, DeepSeek, etc.)</strong> — any OpenAI-compatible API</span>
            </div>
          </div>
          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Keys are encrypted and stored locally. They never leave your machine.
          </p>
        </div>
      ),
      action: (
        <button
          onClick={() => { onGoToSettings(); }}
          style={btnPrimary}
        >
          Go to Settings →
        </button>
      ),
    },
    // Step 2: Train AI
    {
      icon: "🎓",
      title: "Train Your AI Mentor",
      body: (
        <div style={{ fontSize: 14, lineHeight: 1.8, color: "var(--text-secondary)" }}>
          <p style={{ marginBottom: 14 }}>
            To personalize hints, CodeOn needs to learn your coding style.
            In Settings, paste 2-3 of your <strong style={{ color: "var(--text-primary)" }}>accepted solutions</strong>
            from Codeforces or LeetCode.
          </p>
          <p style={{ marginBottom: 14 }}>
            The AI will analyze:
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span>📝</span>
              <span>Your variable naming habits</span>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span>⚙️</span>
              <span>Which STL containers and algorithms you use</span>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span>⚡</span>
              <span>Your optimization patterns (fast I/O, macros, etc.)</span>
            </div>
          </div>
          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
            You can also connect your CF/LC profiles in Settings for automatic topic tracking.
          </p>
        </div>
      ),
      action: (
        <button onClick={() => { onGoToSettings(); }} style={btnPrimary}>
          Go to Settings →
        </button>
      ),
    },
    // Step 3: Start Coding
    {
      icon: "🚀",
      title: "You're Ready!",
      body: (
        <div style={{ fontSize: 14, lineHeight: 1.8, color: "var(--text-secondary)" }}>
          <p style={{ marginBottom: 14 }}>
            That's it! Here's how to start solving:
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span>1️⃣</span>
              <span>Paste a problem URL in the top-left panel (e.g. https://codeforces.com/problemset/problem/2025/A)</span>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span>2️⃣</span>
              <span>Read the problem statement in the left panel</span>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span>3️⃣</span>
              <span>Write your code in the center editor</span>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span>4️⃣</span>
              <span>Click "Give me a hint" in the right panel for AI guidance</span>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span>5️⃣</span>
              <span>Check the "Trail" tab for a step-by-step optimization path</span>
            </div>
          </div>
          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Tip: You can also use the Competitive Companion browser extension to send problems directly to CodeOn.
          </p>
        </div>
      ),
    },
  ];

  const current = steps[step];
  const isLast = step === steps.length - 1;
  const isFirst = step === 0;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 2147483647,
      background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      overflow: "hidden",
    }}>
      <div style={{
        width: "min(560px, 92vw)", maxHeight: "88vh",
        background: "var(--surface-1)", borderRadius: 16,
        border: "1px solid var(--border-default)",
        display: "flex", flexDirection: "column", overflow: "hidden",
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
      }}>
        {/* Header */}
        <div style={{
          padding: "20px 24px 0", display: "flex", justifyContent: "flex-end",
        }}>
          <button onClick={skip} style={{
            background: "none", border: "none", color: "var(--text-muted)",
            fontSize: 13, cursor: "pointer",
          }}>Skip setup ×</button>
        </div>

        {/* Content */}
        <div style={{ padding: "8px 32px 20px", flex: 1, overflowY: "auto" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>{current.icon}</div>
          <h2 style={{
            fontSize: 22, fontWeight: 700, color: "var(--text-primary)",
            marginBottom: 14,
          }}>
            {current.title}
          </h2>
          {current.body}
        </div>

        {/* Footer */}
        <div style={{
          padding: "16px 32px", borderTop: "1px solid var(--border-subtle)",
          background: "var(--surface-2)", display: "flex",
          justifyContent: "space-between", alignItems: "center",
          flexShrink: 0,
        }}>
          {/* Progress dots */}
          <div style={{ display: "flex", gap: 6 }}>
            {steps.map((_, i) => (
              <div key={i} style={{
                width: 8, height: 8, borderRadius: "50%",
                background: i === step ? "var(--brand-violet)" : "var(--surface-4)",
                transition: "background 0.2s",
              }} />
            ))}
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {!isFirst && (
              <button onClick={() => setStep(step - 1)} style={btnSecondary}>
                ← Back
              </button>
            )}
            {current.action}
            {isLast ? (
              <button onClick={finish} style={btnPrimary}>
                Start Coding →
              </button>
            ) : (
              <button onClick={() => setStep(step + 1)} style={btnPrimary}>
                Next →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const btnPrimary: React.CSSProperties = {
  padding: "8px 18px", borderRadius: 8, border: "none",
  background: "linear-gradient(135deg, var(--brand-violet), var(--brand-indigo))",
  color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer",
};

const btnSecondary: React.CSSProperties = {
  padding: "8px 14px", borderRadius: 8,
  background: "var(--surface-3)", border: "1px solid var(--border-default)",
  color: "var(--text-secondary)", fontSize: 13, fontWeight: 500, cursor: "pointer",
};
