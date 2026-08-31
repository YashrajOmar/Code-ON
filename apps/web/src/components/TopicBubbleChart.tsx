"use client";

import { useEffect, useRef, useState } from "react";
import { forceSimulation, forceCenter, forceCollide, forceManyBody } from "d3-force";

/**
 * TopicBubbleChart — D3-force powered interactive bubble chart.
 *
 * Features:
 *   - Force simulation with center + collide (bubbles pack tightly)
 *   - Radius scales with totalProblems
 *   - Vertical progress fill (green from bottom = solvedProblems/totalProblems)
 *   - Hover tooltip with exact stats
 *   - Click to filter (emits selected topic string to parent)
 *   - Hover jiggle physics (slightly re-heats simulation)
 */

export interface TopicData {
  topic: string;
  totalProblems: number;
  solvedProblems: number;
}

interface BubbleNode {
  topic: string;
  totalProblems: number;
  solvedProblems: number;
  radius: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface TopicBubbleChartProps {
  data: TopicData[];
  onSelectTopic?: (topic: string) => void;
  width?: number;
  height?: number;
}

export default function TopicBubbleChart({
  data,
  onSelectTopic,
  width = 600,
  height = 500,
}: TopicBubbleChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [nodes, setNodes] = useState<BubbleNode[]>([]);
  const [hovered, setHovered] = useState<BubbleNode | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const simulationRef = useRef<ReturnType<typeof forceSimulation<BubbleNode>> | null>(null);

  // Scale radius based on totalProblems (min 30, max 80)
  const getRadius = (total: number) => {
    const max = Math.max(...data.map(d => d.totalProblems), 1);
    return 30 + (total / max) * 50;
  };

  useEffect(() => {
    if (!data || data.length === 0) return;

    // Initialize nodes
    const initialNodes: BubbleNode[] = data.map((d, i) => ({
      topic: d.topic,
      totalProblems: d.totalProblems,
      solvedProblems: d.solvedProblems,
      radius: getRadius(d.totalProblems),
      x: width / 2 + (Math.random() - 0.5) * 200,
      y: height / 2 + (Math.random() - 0.5) * 200,
      vx: 0,
      vy: 0,
    }));

    // Create simulation
    const sim = forceSimulation<BubbleNode>(initialNodes)
      .force("center", forceCenter(width / 2, height / 2))
      .force("collide", forceCollide<BubbleNode>().radius(n => n.radius + 2).strength(1))
      .force("charge", forceManyBody().strength(-30))
      .alpha(1)
      .alphaDecay(0.02)
      .on("tick", () => {
        setNodes([...initialNodes]);
      });

    simulationRef.current = sim;

    return () => {
      sim.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, width, height]);

  const handleClick = (node: BubbleNode) => {
    setSelected(selected === node.topic ? null : node.topic);
    onSelectTopic?.(node.topic);
  };

  const handleMouseEnter = (node: BubbleNode) => {
    setHovered(node);
    // Jiggle: re-heat the simulation slightly
    if (simulationRef.current) {
      simulationRef.current.alpha(0.3).restart();
    }
  };

  const handleMouseLeave = () => {
    setHovered(null);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (rect) {
      setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
  };

  if (!data || data.length === 0) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 13 }}>
        No topic data yet
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        onMouseMove={handleMouseMove}
        style={{ display: "block", margin: "0 auto" }}
      >
        <defs>
          {nodes.map((node) => {
            const percent = node.totalProblems > 0
              ? node.solvedProblems / node.totalProblems
              : 0;
            const fillHeight = node.radius * 2 * percent;
            const startY = node.y + node.radius - fillHeight;

            return (
              <clipPath key={`clip-${node.topic}`} id={`clip-${node.topic.replace(/\s+/g, "-")}`}>
                <rect
                  x={node.x - node.radius}
                  y={startY}
                  width={node.radius * 2}
                  height={fillHeight}
                  rx={node.radius}
                />
              </clipPath>
            );
          })}
        </defs>

        {/* Background bubbles (dark gray) */}
        {nodes.map((node) => {
          const isSelected = selected === node.topic;
          const isHovered = hovered?.topic === node.topic;
          const topicId = node.topic.replace(/\s+/g, "-");

          return (
            <g key={`bg-${node.topic}`}>
              <circle
                cx={node.x}
                cy={node.y}
                r={node.radius}
                fill="#1e1e2a"
                stroke={isSelected ? "var(--brand-violet)" : isHovered ? "var(--brand-cyan)" : "rgba(255,255,255,0.1)"}
                strokeWidth={isSelected ? 3 : isHovered ? 2 : 1}
                style={{ cursor: "pointer", transition: "stroke 0.15s" }}
                onClick={() => handleClick(node)}
                onMouseEnter={() => handleMouseEnter(node)}
                onMouseLeave={handleMouseLeave}
              />
              {/* Progress fill (green from bottom) */}
              <circle
                cx={node.x}
                cy={node.y}
                r={node.radius}
                fill={isHovered ? "#10b981" : "#0d8c5e"}
                clipPath={`url(#clip-${topicId})`}
                style={{ pointerEvents: "none" }}
              />
              {/* Label */}
              <text
                x={node.x}
                y={node.y - 4}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="white"
                fontSize={node.radius > 50 ? 12 : node.radius > 35 ? 10 : 8}
                fontWeight={600}
                style={{ pointerEvents: "none", userSelect: "none" }}
              >
                {node.topic.length > 18 ? node.topic.substring(0, 16) + "…" : node.topic}
              </text>
              {/* Count */}
              <text
                x={node.x}
                y={node.y + 10}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="rgba(255,255,255,0.6)"
                fontSize={node.radius > 50 ? 11 : 9}
                style={{ pointerEvents: "none", userSelect: "none" }}
              >
                {node.solvedProblems}/{node.totalProblems}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Tooltip */}
      {hovered && (
        <div
          style={{
            position: "absolute",
            left: mousePos.x + 15,
            top: mousePos.y + 15,
            background: "var(--surface-2)",
            border: "1px solid var(--border-default)",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 12,
            color: "var(--text-primary)",
            pointerEvents: "none",
            zIndex: 100,
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            whiteSpace: "nowrap",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{hovered.topic}</div>
          <div style={{ color: "#10b981" }}>
            {hovered.solvedProblems} / {hovered.totalProblems} Solved
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: 10, marginTop: 2 }}>
            {hovered.totalProblems > 0
              ? Math.round((hovered.solvedProblems / hovered.totalProblems) * 100) + "% complete"
              : "No data"}
          </div>
          {selected === hovered.topic && (
            <div style={{ color: "var(--brand-violet-light)", fontSize: 10, marginTop: 2 }}>
              ✓ Filter active
            </div>
          )}
        </div>
      )}
    </div>
  );
}
