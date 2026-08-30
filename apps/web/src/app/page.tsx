"use client";

import { useState, useEffect, useRef } from "react";
import { useUser } from "@clerk/nextjs";
import Sidebar from "@/components/Sidebar";
import SettingsView from "@/components/SettingsView";
import DashboardView from "@/components/DashboardView";
import type { ProblemData } from "@/components/ProblemPanel";

import dynamic from "next/dynamic";
const ProblemPanel = dynamic(() => import("@/components/ProblemPanel"), { ssr: false });
const EditorPanel = dynamic(() => import("@/components/EditorPanel"), { ssr: false });
const HintPanel = dynamic(() => import("@/components/HintPanel"), { ssr: false });
const CompanionNotifier = dynamic(() => import("@/components/CompanionNotifier"), { ssr: false });
const OnboardingOverlay = dynamic(() => import("@/components/OnboardingOverlay"), { ssr: false });
const InlineTooltips = dynamic(() => import("@/components/InlineTooltips"), { ssr: false });
const DoomsdayBackground = dynamic(() => import("@/components/DoomsdayBackground"), { ssr: false });

const FlexLayoutComponent = dynamic(
  () => import("@/components/FlexLayoutWrapper"),
  { ssr: false }
);

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default function IDEPage() {
  const [activeView, setActiveView] = useState<"ide" | "dashboard" | "settings">("ide");
  const [currentProblem, setCurrentProblem] = useState<ProblemData | null>(null);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);

  const problemRef = useRef(currentProblem);
  problemRef.current = currentProblem;

  const pendingUrlRef = useRef(pendingUrl);
  pendingUrlRef.current = pendingUrl;

  function openProblemInIDE(url: string) {
    setPendingUrl(url);
    setActiveView("ide");
  }

  function handleCompanionProblemLoaded(problem: ProblemData) {
    setCurrentProblem(problem);
    setActiveView("ide");
  }

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--surface-0)" }}>
      <CompanionNotifier onProblemLoaded={handleCompanionProblemLoaded} />

      <Sidebar activeView={activeView} onViewChange={setActiveView} />

      {/* Settings */}
      <div style={{ flex: 1, display: activeView === "settings" ? "flex" : "none", overflow: "hidden" }}>
        <SettingsView />
      </div>

      {/* Dashboard */}
      <div style={{ flex: 1, display: activeView === "dashboard" ? "flex" : "none", overflow: "auto" }}>
        <DashboardView onOpenProblem={openProblemInIDE} />
      </div>

      {/* IDE */}
      <div style={{ flex: 1, display: activeView === "ide" ? "flex" : "none", overflow: "hidden", position: "relative" }}>
        <FlexLayoutComponent
          currentProblem={currentProblem}
          onProblemLoaded={setCurrentProblem}
          pendingUrl={pendingUrl}
          onAutoLoadDone={() => setPendingUrl(null)}
        />
      </div>

      <OnboardingOverlay
        onComplete={() => {}}
        onGoToSettings={() => setActiveView("settings")}
      />
      <InlineTooltips />
      <DoomsdayBackground />
    </div>
  );
}
