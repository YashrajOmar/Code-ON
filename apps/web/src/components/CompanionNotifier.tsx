"use client";

import { useEffect, useState } from "react";
import { useProblemStore } from "@/store/useProblemStore";
import type { ProblemData } from "@/components/ProblemPanel";
import type { PublicScrapedProblemDTO } from "@codeon/scrapers";

interface CompanionNotifierProps {
  onProblemLoaded?: (problem: ProblemData) => void;
}

interface ToastNotification {
  id: string;
  title: string;
  platform: string;
  testCount: number;
}

export default function CompanionNotifier({ onProblemLoaded }: CompanionNotifierProps) {
  const [activeToast, setActiveToast] = useState<ToastNotification | null>(null);
  const setScrapedProblem = useProblemStore((state) => state.setScrapedProblem);

  useEffect(() => {
    let eventSource: EventSource | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;
    let isSubscribed = true;

    function connectSSE() {
      if (!isSubscribed) return;

      try {
        eventSource = new EventSource("/api/companion");

        eventSource.addEventListener("problem", (event) => {
          try {
            const problemDto = JSON.parse(event.data) as PublicScrapedProblemDTO;
            if (!problemDto || !problemDto.title) return;

            // 1. Update Global Problem Store (loads statement & test cases into Monaco/Test Runner)
            setScrapedProblem(problemDto as any);

            // 2. Notify parent view (e.g. IDEPage / FlexLayout)
            if (onProblemLoaded) {
              onProblemLoaded({
                ...problemDto,
                difficulty: "Medium",
                tags: [],
                source: problemDto.platform,
              });
            }

            // 3. Display Toast Notification
            setActiveToast({
              id: `${problemDto.id}-${Date.now()}`,
              title: problemDto.title,
              platform: problemDto.platform?.toUpperCase() || "CP",
              testCount: problemDto.examples?.length || 0,
            });

            // Auto-hide toast after 7s
            setTimeout(() => {
              setActiveToast((current) => (current?.title === problemDto.title ? null : current));
            }, 7000);
          } catch (parseErr) {
            console.error("[CompanionNotifier] Failed to process incoming SSE problem:", parseErr);
          }
        });

        eventSource.onerror = () => {
          if (eventSource) {
            eventSource.close();
            eventSource = null;
          }
          if (isSubscribed) {
            // Reconnect after 3s
            reconnectTimeout = setTimeout(connectSSE, 3000);
          }
        };
      } catch (err) {
        console.warn("[CompanionNotifier] SSE connection error:", err);
        if (isSubscribed) {
          reconnectTimeout = setTimeout(connectSSE, 5000);
        }
      }
    }

    connectSSE();

    return () => {
      isSubscribed = false;
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
    };
  }, [setScrapedProblem, onProblemLoaded]);

  if (!activeToast) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 9999,
        minWidth: 320,
        maxWidth: 420,
        padding: "16px 20px",
        borderRadius: 12,
        background: "rgba(18, 14, 34, 0.95)",
        backdropFilter: "blur(12px)",
        border: "1px solid var(--brand-violet)",
        boxShadow: "0 10px 30px rgba(0, 0, 0, 0.5), 0 0 20px rgba(124, 58, 237, 0.3)",
        animation: "slideInUp 0.3s ease-out",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>⚡</span>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.5px", color: "var(--brand-violet-light)", textTransform: "uppercase" }}>
            Problem Imported
          </span>
        </div>
        <button
          onClick={() => setActiveToast(null)}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            fontSize: 14,
            cursor: "pointer",
            padding: 4,
          }}
        >
          ✕
        </button>
      </div>

      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>
          {activeToast.title}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: "var(--text-secondary)" }}>
          <span className="tag tag-indigo" style={{ fontSize: 10, padding: "2px 6px" }}>
            {activeToast.platform}
          </span>
          <span>{activeToast.testCount} test case{activeToast.testCount === 1 ? "" : "s"} loaded</span>
        </div>
      </div>
    </div>
  );
}
