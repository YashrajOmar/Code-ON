"use client";

import { useRef, useCallback, useEffect } from "react";
import { Layout, Model, TabNode, IJsonModel, Actions } from "flexlayout-react";
import "flexlayout-react/style/dark.css";
import ProblemPanel from "@/components/ProblemPanel";
import EditorPanel from "@/components/EditorPanel";
import HintPanel from "@/components/HintPanel";
import TrailPanel from "@/components/TrailPanel";
import type { ProblemData } from "@/components/ProblemPanel";

// ─── Default layout model (LeetCode-style) ────────────────────────────────────
// Left tabset: Statement / Trail / Editorial
// Center tabset: Code Editor / Test Cases
// Right tabset: AI Hints
const layoutJson: IJsonModel = {
  global: {
    tabEnableClose: false,
    tabEnableRename: false,
    tabSetEnableMaximize: true,
    tabSetEnableDrop: true,
    tabSetEnableDrag: true,
    tabSetEnableDivide: true,
    borderSize: 0,
  },
  borders: [],
  layout: {
    type: "row",
    weight: 100,
    children: [
      {
        type: "tabset",
        weight: 35,
        children: [
          { type: "tab", name: "Statement", component: "statement", enableClose: false },
          { type: "tab", name: "Trail", component: "trail", enableClose: false },
          { type: "tab", name: "Editorial", component: "editorial", enableClose: false },
        ],
      },
      {
        type: "tabset",
        weight: 40,
        children: [
          { type: "tab", name: "Code Editor", component: "editor", enableClose: false },
          { type: "tab", name: "Test Cases", component: "testcases", enableClose: false },
        ],
      },
      {
        type: "tabset",
        weight: 25,
        children: [
          { type: "tab", name: "AI Hints", component: "hints", enableClose: false },
        ],
      },
    ],
  },
};

interface FlexLayoutWrapperProps {
  currentProblem: ProblemData | null;
  onProblemLoaded: (p: ProblemData) => void;
  pendingUrl: string | null;
  onAutoLoadDone: () => void;
}

export default function FlexLayoutWrapper({
  currentProblem,
  onProblemLoaded,
  pendingUrl,
  onAutoLoadDone,
}: FlexLayoutWrapperProps) {
  const modelRef = useRef(Model.fromJson(layoutJson));

  const factory = useCallback(
    (node: TabNode) => {
      const component = node.getComponent();

      switch (component) {
        case "statement":
          return (
            <div style={{ height: "100%", overflow: "auto" }}>
              <ProblemPanel
                onProblemLoaded={onProblemLoaded}
                autoLoadUrl={pendingUrl}
                onAutoLoadDone={onAutoLoadDone}
                activeTab="statement"
                problemData={currentProblem}
              />
            </div>
          );
        case "trail":
          return (
            <TrailPanel problem={currentProblem} />
          );
        case "editorial":
          return (
            <div style={{ height: "100%", overflow: "auto" }}>
              <ProblemPanel
                onProblemLoaded={onProblemLoaded}
                activeTab="editorial"
                problemData={currentProblem}
              />
            </div>
          );
        case "editor":
          return (
            <EditorPanel
              problemTitle={currentProblem?.title}
              problemStatement={currentProblem?.content?.problemStatementMarkdown}
              examples={currentProblem?.examples}
              activeTab="editor"
            />
          );
        case "testcases":
          return (
            <EditorPanel
              problemTitle={currentProblem?.title}
              problemStatement={currentProblem?.content?.problemStatementMarkdown}
              examples={currentProblem?.examples}
              activeTab="testcases"
            />
          );
        case "hints":
          return (
            <HintPanel
              problemTitle={currentProblem?.title}
              problemUrl={currentProblem?.url}
              problemStatement={currentProblem?.content?.problemStatementMarkdown}
              problemTags={currentProblem?.tags}
              editorialMarkdown={currentProblem?.content?.editorialMarkdown}
              referenceSolutions={currentProblem?.referenceSolutions}
            />
          );
        default:
          return <div style={{ padding: 20, color: "var(--text-muted)" }}>Unknown panel: {component}</div>;
      }
    },
    [currentProblem, onProblemLoaded, pendingUrl, onAutoLoadDone]
  );

  return (
    <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
      <Layout
        model={modelRef.current}
        factory={factory}
      />
    </div>
  );
}
