"use client";

import { useEffect, useState } from "react";
import { useTrailStore } from "@/store/useTrailStore";
import { useIDEStore } from "@/store/useIDEStore";

interface TrailTabProps {
  problemUrl: string;
  problemTags: string[];
  code: string;
}

export default function TrailTab({ problemUrl, problemTags, code }: TrailTabProps) {
  const {
    trail,
    currentLevel,
    currentIndex,
    unlockedIndex,
    detectedTechniques,
    timeComplexity,
    spaceComplexity,
    isLoading,
    error,
    fetchTrail,
    unlockNext,
    loadCachedTrail,
    resetTrail,
  } = useTrailStore();

  const [hasFetched, setHasFetched] = useState(false);

  // Load cached trail on mount
  useEffect(() => {
    loadCachedTrail(problemUrl);
  }, [problemUrl]);

  // Fetch trail when code changes (debounced)
  useEffect(() => {
    if (!code || code.trim().length < 10) return;
    const timer = setTimeout(() => {
      fetchTrail(code, problemUrl, problemTags);
      setHasFetched(true);
    }, 1500);
    return () => clearTimeout(timer);
  }, [code, problemUrl]);

  if (isLoading && trail.length === 0) {
    return (
      <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
        <span className="spinner" style={{
          display: "inline-block", width: 16, height: 16,
          border: "2px solid rgba(255,255,255,0.1)", borderTopColor: "var(--brand-violet)",
          borderRadius: "50%", animation: "spin 0.8s linear infinite", marginRight: 8, verticalAlign: "middle",
        }} />
        Analyzing your code with Tree-sitter AST...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 20, color: "var(--brand-rose)", fontSize: 13 }}>
        {error}
      </div>
    );
  }

  if (trail.length === 0) {
    return (
      <div style={{ padding: 20, color: "var(--text-muted)", fontSize: 13 }}>
        Write some code and the optimization trail will appear here.
      </div>
    );
  }

  const tierColors: Record<string, string> = {
    "Brute Force": "var(--brand-rose)",
    "Sub-Optimal": "var(--brand-amber)",
    "Optimal": "var(--brand-emerald)",
  };

  return (
    <div>
      {/* Header: current complexity + detected techniques */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>
          Optimization Trail
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
          Socratic step-by-step path from your current approach to the optimal editorial solution.
        </div>
        {timeComplexity && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <span className="tag tag-violet" style={{ fontSize: 11 }}>
              Your code: {timeComplexity} time, {spaceComplexity} space
            </span>
            {detectedTechniques.length > 0 && detectedTechniques.map((tech, i) => (
              <span key={i} className="tag tag-cyan" style={{ fontSize: 11 }}>{tech}</span>
            ))}
          </div>
        )}
      </div>

      {/* Timeline */}
      <div style={{ position: "relative", paddingLeft: 4 }}>
        {trail.map((milestone, i) => {
          const isUnlocked = i <= unlockedIndex;
          const isCurrent = i === currentIndex;
          const isPast = i < currentIndex;
          const tierColor = tierColors[milestone.tier] || "var(--brand-violet)";

          return (
            <div key={i} style={{ display: "flex", gap: 12, marginBottom: 20, position: "relative" }}>
              {/* Vertical line */}
              {i < trail.length - 1 && (
                <div style={{
                  position: "absolute", left: 11, top: 24, bottom: -12, width: 2,
                  background: isUnlocked ? "var(--surface-4)" : "var(--surface-3)",
                }} />
              )}

              {/* Circle */}
              <div style={{
                width: 24, height: 24, borderRadius: "50%",
                background: isPast ? "var(--brand-emerald)" : isCurrent ? "var(--brand-violet)" : isUnlocked ? tierColor : "var(--surface-4)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, color: "white", fontWeight: 700, flexShrink: 0,
                boxShadow: isCurrent ? "0 0 12px var(--brand-violet)" : "none",
                transition: "all 0.3s",
                opacity: isUnlocked ? 1 : 0.4,
              }}>
                {isPast ? "✓" : i + 1}
              </div>

              {/* Content */}
              <div style={{ flex: 1, opacity: isUnlocked ? 1 : 0.5 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                    textTransform: "uppercase",
                    background: `${tierColor}22`,
                    color: tierColor,
                  }}>
                    {milestone.tier}
                  </span>
                  <span style={{ fontSize: 11, fontFamily: "JetBrains Mono", color: "var(--text-muted)" }}>
                    {milestone.complexity.time} time, {milestone.complexity.space} space
                  </span>
                </div>

                <div style={{ fontSize: 13, fontWeight: isCurrent ? 600 : 400, color: isCurrent ? "var(--text-primary)" : "var(--text-secondary)", marginBottom: 4 }}>
                  {milestone.algorithmicPivot}
                </div>

                {isUnlocked && (
                  <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 8 }}>
                    {milestone.hint}
                  </div>
                )}

                {!isUnlocked && (
                  <div style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic", marginBottom: 8 }}>
                    🔒 Unlock by reaching {milestone.complexity.time} first
                  </div>
                )}

                {isCurrent && (
                  <div style={{ fontSize: 11, color: "var(--brand-violet-light)", fontWeight: 500 }}>
                    ← You are here
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Unlock next button */}
      {unlockedIndex < trail.length - 1 && (
        <button
          onClick={unlockNext}
          style={{
            marginTop: 12, padding: "8px 16px", borderRadius: 8,
            background: "rgba(124,58,237,0.1)", border: "1px solid var(--border-violet)",
            color: "var(--brand-violet-light)", fontSize: 12, fontWeight: 600,
            cursor: "pointer", display: "block", margin: "0 auto",
          }}
        >
          🔓 Reveal next milestone
        </button>
      )}

      {/* Regenerate button */}
      <button
        onClick={() => { resetTrail(); fetchTrail(code, problemUrl, problemTags); }}
        style={{
          marginTop: 12, padding: "6px 14px", borderRadius: 6,
          background: "var(--surface-3)", border: "1px solid var(--border-default)",
          color: "var(--text-muted)", fontSize: 11, cursor: "pointer",
          display: "block", margin: "12px auto 0",
        }}
      >
        🔄 Regenerate Trail
      </button>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
